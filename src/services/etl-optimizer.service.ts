/**
 * ETL Pipeline Optimizer Service
 * Optimizes data extraction, transformation, and loading operations
 * Issue #873
 */

import { Logger } from "../utils/logger.utils";
import { EventEmitter } from 'events';

export interface ETLJob {
  id: string;
  type: 'extract' | 'transform' | 'load';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  recordsProcessed: number;
  errors: any[];
}

export class ETLOptimizerService extends EventEmitter {
  private logger: Logger;
  private activeJobs: Map<string, ETLJob> = new Map();
  private jobHistory: ETLJob[] = [];
  private maxParallelJobs: number;

  constructor(maxParallelJobs: number = 5) {
    super();
    this.logger = new Logger('ETLOptimizer');
    this.maxParallelJobs = maxParallelJobs;
  }

  public async executeETLPipeline(
    extractFn: () => Promise<any[]>,
    transformFn: (data: any[]) => Promise<any[]>,
    loadFn: (data: any[]) => Promise<void>
  ): Promise<void> {
    const jobId = `etl_${Date.now()}`;
    this.logger.info(`Starting ETL pipeline: ${jobId}`);

    try {
      // Extract phase
      const extractJob = this.createJob(jobId + '_extract', 'extract');
      this.activeJobs.set(extractJob.id, extractJob);
      
      extractJob.status = 'running';
      extractJob.startTime = Date.now();
      const extractedData = await extractFn();
      extractJob.recordsProcessed = extractedData.length;
      extractJob.status = 'completed';
      extractJob.endTime = Date.now();
      this.emit('jobCompleted', extractJob);

      // Transform phase with batching
      const transformJob = this.createJob(jobId + '_transform', 'transform');
      this.activeJobs.set(transformJob.id, transformJob);
      
      transformJob.status = 'running';
      transformJob.startTime = Date.now();
      const transformedData = await this.batchTransform(extractedData, transformFn);
      transformJob.recordsProcessed = transformedData.length;
      transformJob.status = 'completed';
      transformJob.endTime = Date.now();
      this.emit('jobCompleted', transformJob);

      // Load phase
      const loadJob = this.createJob(jobId + '_load', 'load');
      this.activeJobs.set(loadJob.id, loadJob);
      
      loadJob.status = 'running';
      loadJob.startTime = Date.now();
      await this.batchLoad(transformedData, loadFn);
      loadJob.recordsProcessed = transformedData.length;
      loadJob.status = 'completed';
      loadJob.endTime = Date.now();
      this.emit('jobCompleted', loadJob);

      this.logger.info(`ETL pipeline completed: ${jobId}`);
    } catch (error) {
      this.logger.error(`ETL pipeline failed: ${jobId}`, error);
      throw error;
    } finally {
      // Move jobs to history
      for (const [id, job] of this.activeJobs.entries()) {
        if (id.startsWith(jobId)) {
          this.jobHistory.push(job);
          this.activeJobs.delete(id);
        }
      }
    }
  }

  private async batchTransform(data: any[], transformFn: (data: any[]) => Promise<any[]>): Promise<any[]> {
    const batchSize = 1000;
    const results: any[] = [];

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const transformed = await transformFn(batch);
      results.push(...transformed);
      
      this.logger.debug(`Transformed batch ${i / batchSize + 1} (${batch.length} records)`);
    }

    return results;
  }

  private async batchLoad(data: any[], loadFn: (data: any[]) => Promise<void>): Promise<void> {
    const batchSize = 500;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      await loadFn(batch);
      
      this.logger.debug(`Loaded batch ${i / batchSize + 1} (${batch.length} records)`);
    }
  }

  private createJob(id: string, type: ETLJob['type']): ETLJob {
    return {
      id,
      type,
      status: 'pending',
      recordsProcessed: 0,
      errors: [],
    };
  }

  public getActiveJobs(): ETLJob[] {
    return Array.from(this.activeJobs.values());
  }

  public getJobHistory(limit: number = 50): ETLJob[] {
    return this.jobHistory.slice(-limit);
  }

  public getPerformanceMetrics(): any {
    const completedJobs = this.jobHistory.filter(j => j.status === 'completed');
    
    if (completedJobs.length === 0) {
      return { averageDuration: 0, totalRecordsProcessed: 0, jobCount: 0 };
    }

    const totalDuration = completedJobs.reduce((sum, job) => {
      return sum + ((job.endTime || 0) - (job.startTime || 0));
    }, 0);

    const totalRecords = completedJobs.reduce((sum, job) => sum + job.recordsProcessed, 0);

    return {
      averageDuration: totalDuration / completedJobs.length,
      totalRecordsProcessed: totalRecords,
      jobCount: completedJobs.length,
      throughput: totalRecords / (totalDuration / 1000), // records per second
    };
  }
}
