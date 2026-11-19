/**
 * Parallel ETL Worker
 * Handles parallel processing of ETL tasks
 * Issue #873
 */

import { Logger } from "../utils/logger.utils";
import { Worker } from 'worker_threads';

export interface WorkerTask {
  id: string;
  data: any;
  operation: 'extract' | 'transform' | 'load';
}

export class ParallelETLWorker {
  private logger: Logger;
  private workerPool: Worker[] = [];
  private maxWorkers: number;

  constructor(maxWorkers: number = 4) {
    this.logger = new Logger('ParallelETLWorker');
    this.maxWorkers = maxWorkers;
  }

  public async processInParallel<T>(
    items: T[],
    processor: (item: T) => Promise<any>,
    concurrency: number = this.maxWorkers
  ): Promise<any[]> {
    const results: any[] = [];
    const chunks = this.chunkArray(items, Math.ceil(items.length / concurrency));

    this.logger.info(`Processing ${items.length} items in ${chunks.length} parallel batches`);

    const promises = chunks.map(async (chunk, index) => {
      this.logger.debug(`Processing chunk ${index + 1}/${chunks.length}`);
      const chunkResults = [];
      
      for (const item of chunk) {
        const result = await processor(item);
        chunkResults.push(result);
      }
      
      return chunkResults;
    });

    const chunkResults = await Promise.all(promises);
    
    for (const chunkResult of chunkResults) {
      results.push(...chunkResult);
    }

    this.logger.info(`Parallel processing complete: ${results.length} items processed`);
    return results;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  public async shutdown(): Promise<void> {
    for (const worker of this.workerPool) {
      await worker.terminate();
    }
    this.workerPool = [];
    this.logger.info('All workers terminated');
  }
}
