import { Queue, QueueEvents } from "bullmq";
import { redisConnection } from "../config/queue";

export interface JobAnalyticsSnapshot {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  totalProcessed: number;
  totalFailed: number;
  averageDurationMs: number;
}

/** Collects queue depth and process outcomes without retaining job payloads. */
export class JobAnalyticsService {
  private readonly events: QueueEvents;
  private readonly startedAt = new Map<string, number>();
  private processed = 0;
  private failed = 0;
  private totalDurationMs = 0;

  constructor(private readonly queue: Queue) {
    this.events = new QueueEvents(queue.name, { connection: redisConnection });
    this.events.on("active", ({ jobId }) => this.startedAt.set(jobId, Date.now()));
    this.events.on("completed", ({ jobId }) => {
      this.processed += 1;
      this.recordDuration(jobId);
    });
    this.events.on("failed", ({ jobId }) => {
      this.failed += 1;
      this.recordDuration(jobId);
    });
  }

  async snapshot(): Promise<JobAnalyticsSnapshot> {
    const counts = await this.queue.getJobCounts(
      "waiting", "active", "completed", "failed", "delayed", "paused",
    );
    return {
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: counts.paused,
      totalProcessed: this.processed,
      totalFailed: this.failed,
      averageDurationMs: this.processed + this.failed === 0
        ? 0
        : Math.round(this.totalDurationMs / (this.processed + this.failed)),
    };
  }

  async close(): Promise<void> {
    await this.events.close();
    this.startedAt.clear();
  }

  private recordDuration(jobId: string): void {
    const started = this.startedAt.get(jobId);
    if (started !== undefined) this.totalDurationMs += Date.now() - started;
    this.startedAt.delete(jobId);
  }
}