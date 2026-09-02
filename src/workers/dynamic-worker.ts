import { Processor, Queue, Worker, WorkerOptions } from "bullmq";
import { redisConnection } from "../config/queue";

export interface DynamicWorkerOptions {
  minWorkers?: number;
  maxWorkers?: number;
  concurrencyPerWorker?: number;
  scaleUpAt?: number;
  scaleDownAt?: number;
  pollIntervalMs?: number;
}

/** Maintains a BullMQ worker pool and adjusts its size from queue depth. */
export class DynamicWorker<T> {
  private readonly workers: Worker<T>[] = [];
  private readonly queue: Queue<T>;
  private readonly options: Required<DynamicWorkerOptions>;
  private monitorTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly queueName: string,
    private readonly processor: Processor<T>,
    options: DynamicWorkerOptions = {},
  ) {
    const minWorkers = Math.max(1, options.minWorkers ?? 1);
    this.options = {
      minWorkers,
      maxWorkers: Math.max(minWorkers, options.maxWorkers ?? 4),
      concurrencyPerWorker: Math.max(1, options.concurrencyPerWorker ?? 5),
      scaleUpAt: Math.max(1, options.scaleUpAt ?? 10),
      scaleDownAt: Math.max(0, options.scaleDownAt ?? 2),
      pollIntervalMs: Math.max(250, options.pollIntervalMs ?? 5_000),
    };
    this.queue = new Queue<T>(queueName, { connection: redisConnection });
  }

  get size(): number {
    return this.workers.length;
  }

  async start(): Promise<void> {
    await this.scaleTo(this.options.minWorkers);
    this.monitorTimer = setInterval(() => void this.rebalance(), this.options.pollIntervalMs);
  }

  async rebalance(): Promise<number> {
    const counts = await this.queue.getJobCounts("waiting", "active", "delayed");
    const depth = counts.waiting + counts.active + counts.delayed;
    const desired = depth >= this.options.scaleUpAt
      ? Math.min(this.options.maxWorkers, Math.ceil(depth / this.options.scaleUpAt))
      : depth <= this.options.scaleDownAt
        ? this.options.minWorkers
        : this.workers.length;
    await this.scaleTo(desired);
    return desired;
  }

  async stop(): Promise<void> {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = undefined;
    await Promise.all(this.workers.splice(0).map((worker) => worker.close()));
    await this.queue.close();
  }

  private async scaleTo(target: number): Promise<void> {
    while (this.workers.length < target) {
      const workerOptions: WorkerOptions = {
        connection: redisConnection,
        concurrency: this.options.concurrencyPerWorker,
      };
      this.workers.push(new Worker<T>(this.queueName, this.processor, workerOptions));
    }
    while (this.workers.length > target) {
      const worker = this.workers.pop();
      if (worker) await worker.close();
    }
  }
}