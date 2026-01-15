/**
 * Request Queue - Limits concurrent Claude Code executions
 */

export interface QueueOptions {
  maxConcurrent?: number;
}

export class Queue {
  private maxConcurrent: number;
  private running: number = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(options: QueueOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 2;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrapped = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processNext();
        }
      };

      if (this.running < this.maxConcurrent) {
        this.running++;
        wrapped();
      } else {
        this.queue.push(wrapped);
      }
    });
  }

  private processNext(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift()!;
      this.running++;
      next();
    }
  }

  get activeCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get length(): number {
    return this.running + this.queue.length;
  }
}

export const requestQueue = new Queue({ maxConcurrent: 2 });
