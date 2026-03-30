import { z } from "zod";
import dotenv from "dotenv";
import path from "path";

// Load environment-specific .env file, then allow .env.local to override
const NODE_ENV = process.env.NODE_ENV || "development";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({
  path: path.resolve(process.cwd(), `.env.${NODE_ENV}`),
  override: true,
});
dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const envSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "test", "production", "staging"])
    .default("development"),
  PORT: z.string().regex(/^\d+$/, "PORT must be a number").default("5000"),
  API_VERSION: z.string().default("v1"),

  // Database
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z
    .string()
    .regex(/^\d+$/, "DB_PORT must be a number")
    .default("5432"),
  DB_NAME: z.string().default("mentorminds"),
  DB_USER: z.string().default("postgres"),
  DB_PASSWORD: z.string().min(1, "DB_PASSWORD is required"),

  // JWT — supports dual secrets for zero-downtime rotation
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  /** Previous JWT secret — accepted during rotation window, then removed. */
  JWT_SECRET_PREVIOUS: z.string().optional(),

  // Stellar
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  STELLAR_HORIZON_URL: z
    .string()
    .url("STELLAR_HORIZON_URL must be a valid URL"),
  PLATFORM_PUBLIC_KEY: z.string().optional(),
  PLATFORM_SECRET_KEY: z.string().optional(),

  // CORS
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:5173"),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().regex(/^\d+$/).default("900000"),
  RATE_LIMIT_MAX_REQUESTS: z.string().regex(/^\d+$/).default("100"),

  // Email (SMTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().regex(/^\d+$/).default("587"),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  GMAIL_USER: z.string().optional(),
  GMAIL_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email().default("noreply@mentorminds.com"),

  // Redis
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL").optional(),

  // Firebase (push notifications)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  // Monitoring / Prometheus
  PROMETHEUS_ENABLED: z.enum(["true", "false"]).default("false"),
  PROMETHEUS_PORT: z
    .string()
    .regex(/^\d+$/, "PROMETHEUS_PORT must be a number")
    .default("9090"),
  PROMETHEUS_ENDPOINT: z.string().default("/metrics"),
  HEALTH_CHECK_INTERVAL: z
    .string()
    .regex(/^\d+$/, "HEALTH_CHECK_INTERVAL must be a number")
    .default("30000"),
  HEALTH_CHECK_TIMEOUT: z
    .string()
    .regex(/^\d+$/, "HEALTH_CHECK_TIMEOUT must be a number")
    .default("5000"),

  // Instance identity (set by orchestrator, e.g. Kubernetes pod name or Docker --name)
  // Falls back to hostname at runtime when absent.
  INSTANCE_ID: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Security
  BCRYPT_ROUNDS: z.string().regex(/^\d+$/).default("10"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters"),
  MFA_TOTP_ISSUER: z.string().default("MentorMinds"),

  // Platform
  PLATFORM_FEE_PERCENTAGE: z.string().regex(/^\d+$/).default("5"),

  // Secrets management
  SECRETS_PROVIDER: z.enum(["env", "aws", "vault"]).default("env"),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_SECRET_ID: z.string().optional(),
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_SECRET_PATH: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Keys that must never appear in logs or error output
// ---------------------------------------------------------------------------
const SENSITIVE_KEYS = new Set([
  "DB_PASSWORD",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_SECRET_PREVIOUS",
  "PLATFORM_SECRET_KEY",
  "SMTP_PASS",
  "GMAIL_PASS",
  "FIREBASE_PRIVATE_KEY",
  "VAULT_TOKEN",
  "AWS_SECRET_ID",
  "ENCRYPTION_KEY",
]);

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => {
        const key = issue.path.join(".");
        // Never reveal the value of a sensitive key in error output
        const hint = SENSITIVE_KEYS.has(key) ? "(value hidden)" : "";
        return `  - ${key}: ${issue.message} ${hint}`.trimEnd();
      })
      .join("\n");

    // Use process.stderr directly — logger may not be initialised yet
    process.stderr.write(
      `\nInvalid environment configuration:\n${formatted}\n\nCheck your .env file against .env.example\n\n`,
    );
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
export type Env = typeof env;
export { SENSITIVE_KEYS };
