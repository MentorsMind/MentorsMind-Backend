import { Job } from "bullmq";
import { JobSchedulerService, ScheduledBatch } from "./job-scheduler.service";

export interface ClusterOptions {
  maxSize?: number;
  flushIntervalMs?: number;
}

interface PendingCluster<T> {
  jobs: ScheduledBatch<T>[];
  timer: NodeJS.Timeout;
}

/** Groups compatible jobs in memory and submits them with one BullMQ addBulk call. */
export class JobClusterService {
  private readonly clusters = new Map<string, PendingCluster<unknown>>();
  private readonly maxSize: number;
  private readonly flushIntervalMs: number;

  constructor(
    private readonly scheduler: JobSchedulerService,
    options: ClusterOptions = {},
  ) {
    this.maxSize = Math.max(1, options.maxSize ?? 50);
    this.flushIntervalMs = Math.max(1, options.flushIntervalMs ?? 100);
  }

  async add<T>(
    clusterKey: string,
    queueName: string,
    job: ScheduledBatch<T>,
  ): Promise<Job<T>[] | undefined> {
    let cluster = this.clusters.get(clusterKey) as PendingCluster<T> | undefined;
    if (!cluster) {
      cluster = {
        jobs: [],
        timer: setTimeout(() => void this.flush<T>(clusterKey, queueName), this.flushIntervalMs),
      };
      this.clusters.set(clusterKey, cluster as PendingCluster<unknown>);
    }
    cluster.jobs.push(job);
    if (cluster.jobs.length < this.maxSize) return undefined;
    return this.flush(clusterKey, queueName);
  }

  async flush<T>(clusterKey: string, queueName: string): Promise<Job<T>[]> {
    const cluster = this.clusters.get(clusterKey) as PendingCluster<T> | undefined;
    if (!cluster) return [];
    clearTimeout(cluster.timer);
    this.clusters.delete(clusterKey);
    return cluster.jobs.length === 0 ? [] : this.scheduler.scheduleBatch(queueName, cluster.jobs);
  }

  async flushAll(queueNameByCluster: (clusterKey: string) => string): Promise<void> {
    await Promise.all(
      [...this.clusters.keys()].map((key) => this.flush(key, queueNameByCluster(key))),
    );
  }

  async close(queueNameByCluster: (clusterKey: string) => string): Promise<void> {
    await this.flushAll(queueNameByCluster);
  }
}