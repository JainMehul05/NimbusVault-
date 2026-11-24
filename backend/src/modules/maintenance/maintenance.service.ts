import { config } from '@config/index';
import prisma from '@database/prisma';
import { createChildLogger } from '@common/logger';
import { tokenService } from '@modules/auth/token.service';
import { uploadService } from '@modules/files/uploads.service';
import { reconcileQuota } from '@modules/files/quota.service';
import { trashService } from '@modules/trash/trash.service';

const log = createChildLogger({ module: 'maintenance' });

const HOURLY = 60 * 60_000;

/**
 * Periodic housekeeping. Every task is idempotent and safe to run on several instances at once
 * (each state change is a conditional update), so no leader election is needed.
 */
export class Maintenance {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private lastHourly = 0;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), config.maintenance.intervalMs);
    this.timer.unref();
    log.info({ intervalMs: config.maintenance.intervalMs }, 'Maintenance started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  private tick(): Promise<void> {
    // Skip a beat rather than overlap when a run takes longer than the interval.
    this.running ??= this.runOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async attempt(name: string, task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
    } catch (err) {
      log.error({ err: (err as Error).message, task: name, event: 'maintenance_failed' }, 'Maintenance task failed');
    }
  }

  async runOnce(): Promise<void> {
    await this.attempt('uploads', () => uploadService.sweepExpired());
    if (Date.now() - this.lastHourly < HOURLY) return;
    this.lastHourly = Date.now();
    await this.attempt('trash', () => trashService.purgeExpired(config.storage.trashRetentionDays));
    await this.attempt('tokens', () => tokenService.deleteExpired());
    await this.attempt('quota', async () => {
      const corrected = await reconcileQuota();
      if (corrected) log.warn({ corrected, event: 'quota_drift' }, 'Corrected storage usage drift');
    });
    await this.attempt('activity', async () => {
      if (config.maintenance.activityRetentionDays <= 0) return;
      const cutoff = new Date(Date.now() - config.maintenance.activityRetentionDays * 86_400_000);
      await prisma.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    });
    await this.attempt('jobs', async () => {
      const cutoff = new Date(Date.now() - 30 * 86_400_000);
      await prisma.aiJob.deleteMany({ where: { completedAt: { lt: cutoff }, status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] } } });
    });
  }
}

export const maintenance = new Maintenance();
