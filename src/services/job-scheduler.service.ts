import { Job, JobsOptions, Queue } from "bullmq";
import { createManagedQueue } from "../queues/queue.manager";
import { defaultJobOptions } from "../config/queue";

export type JobPriority = "critical" | "high" | "normal" | "bulk" | number;

export interface ScheduledJob<T> {
  name: string;
  data: T;
  priority?: JobPriority;
  attempts?: number;
  backoff?: JobsOptions["backoff"];
  delay?: number;
  jobId?: string;
  removeOnComplete?: JobsOptions["removeOnComplete"];
  removeOnFail?: JobsOptions["removeOnFail"];
}

export interface ScheduledBatch<T> {
  name: string;
  data: T;
  opts?: Omit<ScheduledJob<T>, "name" | "data">;
}

const PRIORITY: Record<Exclude<JobPriority, number>, number> = {
  critical: 1,
  high: 5,
  normal: 10,
  bulk: 100,
};

/** Central entry point for queue creation and priority-aware job submission. */
export class JobSchedulerService {
  private readonly queues = new Map<string, Queue<unknown>>();

  getQueue<T>(queueName: string): Queue<T> {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = createManagedQueue<unknown>(queueName);
      this.queues.set(queueName, queue);
    }
    return queue as Queue<T>;
  }

  async schedule<T>(queueName: string, job: ScheduledJob<T>): Promise<Job<T>> {
    const { name, data, ...options } = job;
    return this.getQueue<T>(queueName).add(name, data, this.toJobOptions(options));
  }

  async scheduleBatch<T>(queueName: string, jobs: ScheduledBatch<T>[]): Promise<Job<T>[]> {
    return this.getQueue<T>(queueName).addBulk(
      jobs.map(({ name, data, opts }) => ({ name, data, opts: this.toJobOptions(opts) })),
    );
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }

  private toJobOptions(
    options: Omit<ScheduledJob<unknown>, "name" | "data"> = {},
  ): JobsOptions {
    const { priority, attempts, backoff, delay, jobId, removeOnComplete, removeOnFail } = options;
    return {
      priority: priority === undefined ? undefined : this.resolvePriority(priority),
      attempts,
      backoff: backoff ?? defaultJobOptions.backoff,
      delay,
      jobId,
      removeOnComplete,
      removeOnFail,
    };
  }

  private resolvePriority(priority: JobPriority): number {
    return typeof priority === "number" ? priority : PRIORITY[priority];
  }
}

export const jobScheduler = new JobSchedulerService();