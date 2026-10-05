/**
 * Pipeline Orchestrator Service
 * Manages ETL pipeline scheduling and execution
 * Issue #873
 */

import { Logger } from "../utils/logger.utils";
import { EventEmitter } from 'events';
import { ETLOptimizerService } from './etl-optimizer.service';

export interface PipelineSchedule {
  id: string;
  name: string;
  cronExpression: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  pipeline: () => Promise<void>;
}

export class PipelineOrchestratorService extends EventEmitter {
  private logger: Logger;
  private schedules: Map<string, PipelineSchedule> = new Map();
  private scheduledTimers: Map<string, NodeJS.Timeout> = new Map();
  private etlOptimizer: ETLOptimizerService;

  constructor() {
    super();
    this.logger = new Logger('PipelineOrchestrator');
    this.etlOptimizer = new ETLOptimizerService();
  }

  public registerPipeline(schedule: PipelineSchedule): void {
    this.schedules.set(schedule.id, schedule);
    this.logger.info(`Registered pipeline: ${schedule.name} (${schedule.cronExpression})`);
    
    if (schedule.enabled) {
      this.schedulePipeline(schedule);
    }
  }

  private schedulePipeline(schedule: PipelineSchedule): void {
    // Simple interval-based scheduling (in production, use node-cron or similar)
    const intervalMs = this.parseCronToInterval(schedule.cronExpression);
    
    const timer = setInterval(async () => {
      await this.executePipeline(schedule);
    }, intervalMs);

    this.scheduledTimers.set(schedule.id, timer);
    schedule.nextRun = Date.now() + intervalMs;
  }

  private parseCronToInterval(cron: string): number {
    // Simplified cron parsing - in production use proper cron library
    if (cron.includes('hourly')) return 3600000;
    if (cron.includes('daily')) return 86400000;
    return 3600000; // Default to hourly
  }

  private async executePipeline(schedule: PipelineSchedule): Promise<void> {
    this.logger.info(`Executing pipeline: ${schedule.name}`);
    schedule.lastRun = Date.now();

    try {
      await schedule.pipeline();
      this.emit('pipelineCompleted', { scheduleId: schedule.id, success: true });
    } catch (error) {
      this.logger.error(`Pipeline execution failed: ${schedule.name}`, error);
      this.emit('pipelineFailed', { scheduleId: schedule.id, error });
    }
  }

  public async executeNow(scheduleId: string): Promise<void> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      throw new Error(`Pipeline not found: ${scheduleId}`);
    }

    await this.executePipeline(schedule);
  }

  public disablePipeline(scheduleId: string): void {
    const schedule = this.schedules.get(scheduleId);
    if (schedule) {
      schedule.enabled = false;
      const timer = this.scheduledTimers.get(scheduleId);
      if (timer) {
        clearInterval(timer);
        this.scheduledTimers.delete(scheduleId);
      }
      this.logger.info(`Disabled pipeline: ${schedule.name}`);
    }
  }

  public enablePipeline(scheduleId: string): void {
    const schedule = this.schedules.get(scheduleId);
    if (schedule) {
      schedule.enabled = true;
      this.schedulePipeline(schedule);
      this.logger.info(`Enabled pipeline: ${schedule.name}`);
    }
  }

  public getAllPipelines(): PipelineSchedule[] {
    return Array.from(this.schedules.values());
  }

  public shutdown(): void {
    for (const timer of this.scheduledTimers.values()) {
      clearInterval(timer);
    }
    this.scheduledTimers.clear();
    this.logger.info('Pipeline orchestrator shutdown complete');
  }
}
