import { env } from "./env";
import monitoringConfig from "./monitoring.config";
import retentionConfig from "./retention.config";

const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  isTest: env.NODE_ENV === "test",
  isDevelopment: env.NODE_ENV === "development",

  server: {
    port: parseInt(env.PORT, 10),
    apiVersion: env.API_VERSION,
  },

  db: {
    url: env.DATABASE_URL,
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT, 10),
    name: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    poolMax: parseInt(env.DB_POOL_MAX, 10),
    poolMin: parseInt(env.DB_POOL_MIN, 10),
    idleTimeoutMs: parseInt(env.DB_IDLE_TIMEOUT_MS, 10),
    connectionTimeoutMs: parseInt(env.DB_CONNECTION_TIMEOUT_MS, 10),
    statementTimeoutMs: parseInt(env.DB_STATEMENT_TIMEOUT_MS, 10),
    poolExhaustionThreshold: parseInt(env.DB_POOL_EXHAUSTION_THRESHOLD, 10),
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    /** Previous secret — accepted during rotation window. */
    previousSecret: env.JWT_SECRET_PREVIOUS,
  },

  stellar: {
    network: env.STELLAR_NETWORK,
    horizonUrl: env.STELLAR_HORIZON_URL,
    platformPublicKey: env.PLATFORM_PUBLIC_KEY,
  },

  cors: {
    origins: env.CORS_ORIGIN.split(",").map((o: string) => o.trim()),
  },

  rateLimit: {
    windowMs: parseInt(env.RATE_LIMIT_WINDOW_MS, 10),
    maxRequests: parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10),
  },

  email: {
    smtp: {
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT, 10),
      secure: env.SMTP_SECURE === "true",
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    gmail: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_PASS,
    },
    fromEmail: env.FROM_EMAIL,
  },

  redis: {
    url: env.REDIS_URL,
  },

  logging: {
    level: env.LOG_LEVEL,
  },

  security: {
    bcryptRounds: parseInt(env.BCRYPT_ROUNDS, 10),
  },

  platform: {
    feePercentage: parseInt(env.PLATFORM_FEE_PERCENTAGE, 10),
  },

  monitoring: monitoringConfig,
  retention: retentionConfig,
} as const;

export default config;
export type Config = typeof config;
