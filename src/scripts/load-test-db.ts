import { optimizedPool } from '../config/database-pool.config';
import { QueryMonitor } from '../utils/query-monitor.utils';

async function runLoadTest(concurrentRequests: number, iterations: number) {
  console.log(`Starting load test with ${concurrentRequests} concurrent queries...`);
  
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
        console.error(`Query ${index} failed:`, error);
      } finally {
        if (client) client.release();
      }
    });

    await Promise.allSettled(promises);
  }

  const duration = Date.now() - startTime;
  console.log(`Load test completed in ${duration}ms.`);
  console.log(`Successful Queries: ${successCount}`);
  console.log(`Failed Queries: ${errorCount}`);

  await optimizedPool.end();
}

// Example usage: 50 concurrent requests over 5 iterations
if (require.main === module) {
  runLoadTest(50, 5).catch(console.error);
}

export { runLoadTest };
