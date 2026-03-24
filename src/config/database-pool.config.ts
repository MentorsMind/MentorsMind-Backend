import { Pool, PoolConfig } from 'pg';
import config from './index';

export const poolConfig: PoolConfig = {
  connectionString: config.db.url,
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: config.db.poolMax || 20, // Database connection pooling optimization
  idleTimeoutMillis: config.db.idleTimeoutMs || 30000,
  connectionTimeoutMillis: config.db.connectionTimeoutMs || 2000,
  statement_timeout: 10000, // Implement query timeout handling (10 seconds)
  query_timeout: 10000,     // Terminate queries that take longer than 10s
  min: 4,                   // Maintain a minimum pool of connections to prevent slow starts
  allowExitOnIdle: false,
};

export const createOptimizedPool = (): Pool => {
  const pool = new Pool(poolConfig);
  
  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err.message);
  });
  
  pool.on('connect', (client) => {
    // Session-level configurations for optimization
    client.query('SET join_collapse_limit = 8').catch(() => {});
    client.on('error', (error) => {
      console.error('Database client error:', error.message);
    });
  });

  return pool;
};

export const optimizedPool = createOptimizedPool();
export default optimizedPool;
