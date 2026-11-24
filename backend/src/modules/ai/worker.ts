import { hostname } from 'os';
import { randomUUID } from 'crypto';
import { config } from '@config/index';
import { createChildLogger } from '@common/logger';
import { aiIndexingService } from './indexing.service';
import { setWorkerRunning } from './ai.status';

const log = createChildLogger({ module: 'ai-worker' });

/**
 * In-process, database-backed job runner. Jobs live in the ai_jobs table (durable across
 * restarts); claiming uses FOR UPDATE SKIP LOCKED so several API instances can run workers
 * safely. Work never runs inside request handlers, and a slow or failing job cannot block HTTP
 * traffic beyond the bounded `concurrency` slots.
 */
export class AiWorker {
  private readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readonly inFlight = new Set<Promise<void>>();
  private lastRecovery = 0;

  start(): void {
    if (this.timer || !aiIndexingService.isEnabled()) {
      if (!aiIndexingService.isEnabled()) log.info('AI worker not started: no embedding provider configured');
      return;
    }
    this.stopping = false;
    setWorkerRunning(true);
    log.info({ workerId: this.id, concurrency: config.ai.worker.concurrency }, 'AI worker started');
    void this.tick();
  }

  private schedule(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), config.ai.worker.pollMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      if (Date.now() - this.lastRecovery > 60_000) {
        this.lastRecovery = Date.now();
        await aiIndexingService.recoverStaleJobs();
      }
      while (!this.stopping && this.inFlight.size < config.ai.worker.concurrency) {
        const job = await aiIndexingService.claimNextJob(this.id);
        if (!job) break;
        const run = aiIndexingService
          .processJob(job)
          .then(() => undefined)
          .catch((err) => log.error({ err: (err as Error).message, jobId: job.id }, 'Job crashed'))
          .finally(() => {
            this.inFlight.delete(run);
            if (!this.stopping) void this.tick();
          });
        this.inFlight.add(run);
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'AI worker poll failed');
    } finally {
      if (this.timer) clearTimeout(this.timer);
      this.schedule();
    }
  }

  /** Stops claiming work and waits (bounded) for in-flight jobs. Unfinished jobs are recovered on restart. */
  async stop(timeoutMs = 20_000): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    setWorkerRunning(false);
    if (this.inFlight.size === 0) return;
    log.info({ inFlight: this.inFlight.size }, 'Waiting for AI jobs to finish');
    await Promise.race([
      Promise.allSettled([...this.inFlight]),
      new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
  }
}

export const aiWorker = new AiWorker();
