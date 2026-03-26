import { optimizedPool } from '../config/database-pool.config';
import { QueryMonitor } from '../utils/query-monitor.utils';
import { logger } from '../utils/logger';

async function runLoadTest(concurrentRequests: number, iterations: number) {
  logger.info(`Starting load test with ${concurrentRequests} concurrent queries...`);
  
  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const promises = Array.from({ length: concurrentRequests }).map(async (_, index) => {
      let client;
      try {
        client = await optimizedPool.connect();
        
        // Simulating random queries
        const queries = [
          'SELECT NOW()',
          'SELECT 1',
          'SELECT gen_random_uuid()'
        ];
        
        const randomQuery = queries[Math.floor(Math.random() * queries.length)];
        await QueryMonitor.execute(client, randomQuery, [], { timeoutMs: 2000 });
        successCount++;
      } catch (error) {
        errorCount++;
        logger.error(`Query ${index} failed:`, error);
      } finally {
        if (client) client.release();
      }
    });

    await Promise.allSettled(promises);
  }

  const duration = Date.now() - startTime;
  logger.info(`Load test completed in ${duration}ms.`);
  logger.info(`Successful Queries: ${successCount}`);
  logger.info(`Failed Queries: ${errorCount}`);

  await optimizedPool.end();
}

// Example usage: 50 concurrent requests over 5 iterations
if (require.main === module) {
  runLoadTest(50, 5).catch((err) => logger.error('Load test failed', { error: err }));
}

export { runLoadTest };
