import { randomUUID } from 'crypto';
import { AppError } from '@common/errors';

/**
 * In-memory asynchronous answer jobs. CloudFront (≤120 s) and API Gateway (30 s) cannot hold a
 * multi-minute CPU inference request open, so the browser starts a job and polls for its result.
 * Jobs are owner-scoped, bounded in number and expire; a lost job (API restart) reports 404.
 */
type JobState = 'running' | 'done' | 'error';
interface Job {
  id: string;
  userId: string;
  state: JobState;
  createdAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: { status: number; code: string; message: string };
}

const TTL_MS = 15 * 60 * 1000;
const MAX_JOBS = 200;
const jobs = new Map<string, Job>();

function sweep(now = Date.now()) {
  for (const [id, job] of jobs) if (now - job.createdAt > TTL_MS) jobs.delete(id);
}

export const askJobs = {
  start(userId: string, run: () => Promise<unknown>): Job {
    sweep();
    if ([...jobs.values()].some((j) => j.userId === userId && j.state === 'running')) {
      throw new AppError('An answer is already being prepared for this account. Wait for it or stop it first.', 409, 'AI_BUSY');
    }
    if (jobs.size >= MAX_JOBS) throw new AppError('The answer service is busy. Try again shortly.', 503, 'AI_BUSY');
    const job: Job = { id: randomUUID(), userId, state: 'running', createdAt: Date.now() };
    jobs.set(job.id, job);
    run().then(
      (result) => Object.assign(job, { state: 'done', result, finishedAt: Date.now() }),
      (error: unknown) => {
        const e = error as Partial<AppError>;
        Object.assign(job, {
          state: 'error',
          finishedAt: Date.now(),
          error: {
            status: typeof e.statusCode === 'number' ? e.statusCode : 500,
            code: typeof e.code === 'string' ? e.code : 'AI_FAILED',
            message: e.isOperational && typeof e.message === 'string' ? e.message : 'The answer could not be prepared',
          },
        });
      },
    );
    return job;
  },
  get(userId: string, id: string): Job {
    sweep();
    const job = jobs.get(id);
    // Other users' jobs are indistinguishable from missing ones.
    if (!job || job.userId !== userId) throw AppError.notFound('Answer job not found', 'AI_JOB_NOT_FOUND');
    return job;
  },
  /** Test helper. */
  clear() { jobs.clear(); },
};
