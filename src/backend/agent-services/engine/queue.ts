/**
 * agent-services/engine/queue.ts — in-memory job queue, one per service.
 *
 * Two knobs cover every service so far:
 *   - concurrency: max jobs running at once (image-gen: 5).
 *   - key: jobs sharing a key never overlap (agent-phone: one call per
 *     recipient at a time; different recipients run in parallel).
 *
 * Jobs start in FIFO order, except that a job whose key is busy is skipped
 * over until its key frees up. In-memory only: on restart, queued work is
 * lost and the agent's helper times out, same as before the engine existed.
 */

export interface QueueJob {
  /** Serialization key, or undefined for none. */
  key?: string;
  run(): Promise<void>;
}

export interface JobQueueOptions {
  concurrency: number;
  maxDepth: number;
  /** Called when a job's run() rejects. run() should not throw; this is a backstop. */
  onJobError(err: unknown, job: QueueJob): void;
}

export class JobQueue {
  private readonly pending: QueueJob[] = [];
  private readonly runningKeys = new Set<string>();
  private running = 0;
  private stopped = false;

  constructor(private readonly opts: JobQueueOptions) {}

  /** Returns false (and drops the job) when the queue is full or stopped. */
  enqueue(job: QueueJob): boolean {
    if (this.stopped || this.pending.length >= this.opts.maxDepth) return false;
    this.pending.push(job);
    this.pump();
    return true;
  }

  /** Stop starting new jobs. Running jobs finish; pending ones are dropped. */
  stop(): void {
    this.stopped = true;
    this.pending.length = 0;
  }

  snapshot(): { pending: number; running: number } {
    return { pending: this.pending.length, running: this.running };
  }

  private pump(): void {
    for (
      let i = 0;
      i < this.pending.length && this.running < this.opts.concurrency;
    ) {
      const job = this.pending[i];
      if (job.key !== undefined && this.runningKeys.has(job.key)) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      this.start(job);
    }
  }

  private start(job: QueueJob): void {
    this.running++;
    if (job.key !== undefined) this.runningKeys.add(job.key);
    void job
      .run()
      .catch((err) => this.opts.onJobError(err, job))
      .finally(() => {
        this.running--;
        if (job.key !== undefined) this.runningKeys.delete(job.key);
        if (!this.stopped) this.pump();
      });
  }
}
