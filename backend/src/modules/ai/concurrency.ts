import { AppError } from '@common/errors';

/**
 * Bounded concurrency for paid/expensive model calls. Callers beyond `max` wait in a queue of
 * at most `maxQueue`; beyond that they are rejected with 429 so load cannot amplify cost.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly maxQueue: number
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiters.length >= this.maxQueue) {
        throw AppError.tooManyRequests('The AI assistant is busy. Please try again shortly.', 'AI_BUSY');
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
