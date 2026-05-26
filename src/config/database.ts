import { Pool, PoolConfig } from "pg";
import config from "./index";
import { logger } from "../utils/logger";

export const poolConfig: PoolConfig = {
  connectionString: config.db.url,
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: config.db.poolMax,
  min: config.db.poolMin,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
  statement_timeout: config.db.statementTimeoutMs,
  query_timeout: config.db.statementTimeoutMs,
  allowExitOnIdle: false,
};

export const pool = new Pool(poolConfig);

export const createOptimizedPool = (): Pool => {
  const optimized = new Pool(poolConfig);

  optimized.on("error", (err) => {
    logger.error({ error: err.message }, "Unexpected database pool error");
  });

  optimized.on("connect", (client) => {
    client.query("SET join_collapse_limit = 8").catch(() => {});
    client.on("error", (error) => {
      logger.error({ error: error.message }, "Database client error");
    });
  });

  return optimized;
};

export const testConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    logger.info("Database connected successfully");
    client.release();
    return true;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : error },
      "Database connection failed",
    );
    return false;
  }
};

pool.on("error", (err) => {
  logger.error({ error: err.message }, "Unexpected database pool error");
});

pool.on("connect", (client) => {
  client.query("SET join_collapse_limit = 8").catch(() => {});
  client.on("error", (error) => {
    logger.error({ error: error.message }, "Database client error");
  });
});

export default pool;
