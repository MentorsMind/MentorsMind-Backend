import { Client } from 'pg';
import { logger } from '../utils/logger';

const SLOW_QUERY_THRESHOLD_MS = 500;
const ALERT_THRESHOLD_PERCENT = 5;

let totalQueries = 0;
let slowQueries = 0;

export async function trackAndLogQuery(
  client: Client,
  sql: string,
  params: any[]
): Promise<any> {
  const start = process.hrtime.bigint();
  totalQueries++;

  try {
    const result = await client.query(sql, params);
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1000000;

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      slowQueries++;
      
      let queryPlan = 'Unable to fetch plan';
      try {
        const explainResult = await client.query(`EXPLAIN ${sql}`, params);
        queryPlan = explainResult.rows.map(row => row['QUERY PLAN']).join('\n');
      } catch (explainError) {
        logger.error('Failed to fetch query plan', { error: explainError });
      }

      const indexRecommendations = generateIndexRecommendations(queryPlan);

      logger.warn('Slow query detected', {
        durationMs,
        sql,
        params,
        queryPlan,
        indexRecommendations,
      });

      checkAlertThreshold();
    }

    return result;
  } catch (error) {
    throw error;
  }
}

function generateIndexRecommendations(queryPlan: string): string[] {
  const recommendations: string[] = [];
  if (queryPlan.includes('Seq Scan')) {
    const match = queryPlan.match(/Seq Scan on (\w+)/);
    if (match && match[1]) {
      recommendations.push(`Consider adding an index on the filtered columns of table "${match[1]}" to avoid Sequential Scans.`);
    }
  }
  return recommendations;
}

function checkAlertThreshold(): void {
  if (totalQueries > 20) {
    const slowPercentage = (slowQueries / totalQueries) * 100;
    if (slowPercentage > ALERT_THRESHOLD_PERCENT) {
      logger.error(`PERFORMANCE ALERT: ${slowPercentage.toFixed(2)}% of queries are slow (>500ms).`);
    }
  }
}
