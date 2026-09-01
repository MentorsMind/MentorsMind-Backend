import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "path";

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
  DB_POOL_MAX: z.string().regex(/^\d+$/).default("20"),
  DB_POOL_MIN: z.string().regex(/^\d+$/).default("4"),
  DB_IDLE_TIMEOUT_MS: z.string().regex(/^\d+$/).default("30000"),
  DB_CONNECTION_TIMEOUT_MS: z.string().regex(/^\d+$/).default("2000"),
  DB_STATEMENT_TIMEOUT_MS: z.string().regex(/^\d+$/).default("10000"),
  DB_POOL_EXHAUSTION_THRESHOLD: z.string().regex(/^\d+$/).default("90"),
  DB_CIRCUIT_BREAKER_ENABLED: z.enum(["true", "false"]).default("true"),

  // JWT — supports dual secrets for zero-downtime rotation
  JWT_SECRET: z.string().min(64, "JWT_SECRET must be at least 64 characters"), // Increased from 32
  JWT_EXPIRES_IN: z.string().default("15m"), // Reduced from 7d for better security
  JWT_REFRESH_SECRET: z
    .string()
    .min(64, "JWT_REFRESH_SECRET must be at least 64 characters"), // Increased from 32
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"), // Reduced from 30d
  /** Previous JWT secret — accepted during rotation window, then removed. */
  JWT_SECRET_PREVIOUS: z.string().optional(),
  PII_ENCRYPTION_KEYS: z.string().min(1, "PII_ENCRYPTION_KEYS is required for production").optional(),
  PII_ENCRYPTION_CURRENT_KEY_VERSION: z.string().default("1"),

  // File Signing — separate secret for file access tokens (prevents conflation with JWT_SECRET)
  FILE_SIGNING_SECRET: z
    .string()
    .min(64, "FILE_SIGNING_SECRET must be at least 64 characters"), // Increased from 32

  // Cache Key Signing (issue #716) — HMACs the userId component of authenticated
  // cache keys so keys can't be guessed/enumerated. Falls back to FILE_SIGNING_SECRET
  // when unset so existing deployments don't need a new required secret.
  CACHE_KEY_HMAC_SECRET: z.string().min(64).optional(), // Increased from 32

  // Stellar
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  STELLAR_HORIZON_URL: z
    .string()
    .url("STELLAR_HORIZON_URL must be a valid URL"),
  PLATFORM_PUBLIC_KEY: z.string().optional(),
  PLATFORM_SECRET_KEY: z.string().optional(),
  /** Public key of the HSM-provisioned platform Stellar key (issue #982) */
  STELLAR_FUNDING_PUBLIC_KEY: z.string().optional(),

  // CORS
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,http://localhost:5173"),
  /**
   * Preflight cache duration in seconds (sent as Access-Control-Max-Age).
   * Default: 86400 (24 h). Set to 0 to disable caching during development.
   */
  CORS_MAX_AGE: z
    .string()
    .regex(/^\d+$/, "CORS_MAX_AGE must be a non-negative integer")
    .default("86400"),

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

  // Email provider selection: sendgrid | mailgun | smtp (default: smtp)
  EMAIL_PROVIDER: z.enum(["sendgrid", "mailgun", "smtp"]).default("smtp"),

  // SendGrid
  SENDGRID_API_KEY: z.string().optional(),

  // Mailgun
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_HOST: z.string().default("api.mailgun.net"),

  // Webhook secret for validating bounce/complaint callbacks
  EMAIL_WEBHOOK_SECRET: z.string().optional(),

  // Redis
  REDIS_URL: z.string().url("REDIS_URL must be a valid URL").optional(),
  REDIS_CLUSTER_ENABLED: z.enum(["true", "false"]).default("false"),
  REDIS_CLUSTER_NODES: z.string().optional(),
  REDIS_TLS_ENABLED: z.enum(["true", "false"]).default("false"),

  // Microservices
  AUTH_SERVICE_URL: z.string().url().optional(),
  USER_SERVICE_URL: z.string().url().optional(),
  BOOKING_SERVICE_URL: z.string().url().optional(),
  PAYMENT_SERVICE_URL: z.string().url().optional(),
  NOTIFICATION_SERVICE_URL: z.string().url().optional(),
  ANALYTICS_SERVICE_URL: z.string().url().optional(),

  // Firebase (push notifications)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),

  // APNS (Apple Push Notification Service) — configured via FCM APNS bridge
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),

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

  // Admin IP Whitelist
  ADMIN_IP_WHITELIST: z.string().default(""),

  // Instance identity (set by orchestrator, e.g. Kubernetes pod name or Docker --name)
  // Falls back to hostname at runtime when absent.
  INSTANCE_ID: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Security (Enhanced)
  BCRYPT_ROUNDS: z.string().regex(/^\d+$/).default("12"), // Increased from 10
  ENCRYPTION_KEY: z
    .string()
    .min(64, "ENCRYPTION_KEY must be at least 64 characters"), // Increased from 32
  MFA_TOTP_ISSUER: z.string().default("MentorMinds"),

  // WebAuthn / FIDO2
  MFA_WEBAUTHN_RP_NAME: z.string().default("MentorMinds"),
  MFA_WEBAUTHN_RP_ID: z.string().default("localhost"),
  MFA_WEBAUTHN_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:5173"),

  // SMS MFA (Twilio or AWS SNS)
  SMS_PROVIDER: z.enum(["twilio", "aws_sns", "mock"]).default("mock"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  AWS_SNS_REGION: z.string().optional(),

  // Session Security (Enhanced)
  SESSION_MAX_CONCURRENT: z.string().regex(/^\d+$/).default("0"),
  SESSION_AUTO_REVOKE_HIJACK: z.enum(["true", "false"]).default("true"),
  SESSION_MFA_STEPUP_THRESHOLD: z.string().regex(/^\d+$/).default("0"),
  SESSION_FINGERPRINT_SALT: z.string().default("mentorminds-session-fp-v1"),
  REFRESH_TOKEN_COOKIE: z.string().default("mm_refresh"),
  SESSION_SECURITY_SKIP_PATHS: z.string().default("/health,/metrics,/static"),

  // Geo IP
  GEO_PROVIDER: z.enum(["ipinfo", "ip-api", "maxmind"]).default("ip-api"),
  GEO_IPINFO_TOKEN: z.string().optional(),
  MAXMIND_ACCOUNT_ID: z.string().optional(),
  MAXMIND_LICENSE_KEY: z.string().optional(),

  // Session Security
  SESSION_TIMEOUT_MINUTES: z.string().regex(/^\d+$/).default("30"),
  MAX_LOGIN_ATTEMPTS: z.string().regex(/^\d+$/).default("5"),
  ACCOUNT_LOCKOUT_DURATION_MINUTES: z.string().regex(/^\d+$/).default("15"),
  
  // Password Policy
  PASSWORD_HISTORY_COUNT: z.string().regex(/^\d+$/).default("12"),
  PASSWORD_EXPIRY_DAYS: z.string().regex(/^\d+$/).default("90"),
  
  // API Security
  API_KEY_ROTATION_INTERVAL_DAYS: z.string().regex(/^\d+$/).default("30"),
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS: z.string().regex(/^\d+$/).default("300"),
  
  // Security Headers
  SECURITY_HEADERS_ENABLED: z.enum(["true", "false"]).default("true"),
  CONTENT_SECURITY_POLICY_STRICT: z.enum(["true", "false"]).default("true"),
  
  // IP Security
  TRUSTED_PROXIES: z.string().default(""), // Comma-separated list of trusted proxy IPs
  MAX_REQUEST_SIZE_MB: z.string().regex(/^\d+$/).default("10"),
  
  // Audit & Compliance
  AUDIT_LOG_RETENTION_DAYS: z.string().regex(/^\d+$/).default("2555"), // 7 years
  PCI_COMPLIANCE_MODE: z.enum(["true", "false"]).default("false"),
  GDPR_COMPLIANCE_MODE: z.enum(["true", "false"]).default("true"),

  // Platform
  PLATFORM_FEE_PERCENTAGE: z.string().regex(/^\d+$/).default("10"),

  // Secrets management
  SECRETS_PROVIDER: z.enum(["env", "aws", "vault"]).default("env"),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_S3_BUCKET: z.string().min(1, "AWS_S3_BUCKET is required"),
  AWS_ACCESS_KEY_ID: z.string().min(1, "AWS_ACCESS_KEY_ID is required"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS_SECRET_ACCESS_KEY is required"),
  AWS_SECRET_ID: z.string().optional(),
  AWS_TRANSCRIBE_REGION: z.string().optional(), // defaults to AWS_REGION if not set
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_SECRET_PATH: z.string().optional(),

  // Sentry
  SENTRY_DSN: z.string().optional(),
  DAILY_API_KEY: z.string().optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:5000"),
  APP_CLIENT_URL: z.string().url().default("http://localhost:3000"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Deep Linking
  DEEP_LINK_SCHEME: z.string().default("mentorminds"),
  IOS_BUNDLE_ID: z.string().default("com.mentorminds.app"),
  ANDROID_PACKAGE_NAME: z.string().default("com.mentorminds.app"),
  IOS_APP_STORE_URL: z.string().url().optional(),
  ANDROID_PLAY_STORE_URL: z.string().url().optional(),

  // CDN
  CDN_PROVIDER: z.enum(["cloudfront", "cloudflare", "fastly"]).optional(),
  CDN_BASE_URL: z.string().url().optional(),
  CDN_DOMAINS: z.string().optional(), // Comma-separated list of domains
  CDN_IMAGE_RESIZE: z.enum(["true", "false"]).default("true"),
  CDN_WEBP_CONVERSION: z.enum(["true", "false"]).default("true"),
  CDN_COMPRESSION: z.enum(["true", "false"]).default("true"),
  CDN_CLOUDFRONT_DISTRIBUTION_ID: z.string().optional(),
  CDN_CLOUDFLARE_ZONE_ID: z.string().optional(),
  CDN_CLOUDFLARE_API_TOKEN: z.string().optional(),
  CDN_FASTLY_SERVICE_ID: z.string().optional(),
  CDN_FASTLY_API_KEY: z.string().optional(),

  // Elasticsearch / ELK Stack (issue #740)
  ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  ELASTICSEARCH_API_KEY: z.string().optional(),
  ELASTICSEARCH_ENABLED: z.enum(["true", "false"]).default("true"),
  ELASTICSEARCH_INDEX_PREFIX: z.string().default("mentorminds"),
  /** Max log documents to buffer before flushing to Elasticsearch */
  ELK_BATCH_SIZE: z.string().regex(/^\d+$/).default("100"),
  /** Flush interval in ms for the ELK batch transport */
  ELK_FLUSH_INTERVAL_MS: z.string().regex(/^\d+$/).default("5000"),
  /** Max retry attempts for failed ELK bulk requests */
  ELK_MAX_RETRIES: z.string().regex(/^\d+$/).default("3"),

  // Stellar (additional keys)
  STELLAR_FUNDING_SECRET: z.string().optional(),

  // Recording / Video
  RECORDING_PROVIDER: z.string().optional(),
  AWS_IVS_CHANNEL_ARN: z.string().optional(),
  AWS_IVS_REGION: z.string().optional(),
  AGORA_APP_ID: z.string().optional(),
  AGORA_APP_CERTIFICATE: z.string().optional(),
  RECORDING_RETENTION_DAYS: z.string().regex(/^\d+$/).default("30"),
  RECORDING_TRANSCRIPTION_ENABLED: z.enum(["true", "false"]).default("false"),
  TRANSCRIPTION_PROVIDER: z.string().optional(),

  // Data Retention
  RETENTION_NOTIFICATIONS_DAYS: z.string().regex(/^\d+$/).default("90"),
  RETENTION_AUDIT_LOGS_YEARS: z.string().regex(/^\d+$/).default("7"),
  RETENTION_PAYMENTS_YEARS: z.string().regex(/^\d+$/).default("7"),
  RETENTION_SESSIONS_YEARS: z.string().regex(/^\d+$/).default("2"),
  // Audit Log Archival (issue #772) — audit rows older than this move from hot
  // PostgreSQL storage to a compressed, S3 Object Lock (WORM) archive, so they
  // remain queryable for RETENTION_AUDIT_LOGS_YEARS without staying in the DB.
  AUDIT_ARCHIVE_AFTER_DAYS: z.string().regex(/^\d+$/).default("90"),

  // API Documentation Portal (issue #784)
  // Enables the /api/v1/sandbox/* routes and adds a "Sandbox" server option
  // to the Swagger UI so third-party developers can try endpoints against
  // fixture data with no real side effects.
  SANDBOX_MODE: z.enum(["true", "false"]).default("false"),

  // Email CDN assets (issue #752)
  // Physical mailing address shown in email footers for CAN-SPAM / GDPR compliance.
  COMPANY_ADDRESS: z.string().default("MentorMinds, Inc. — mentorminds.com"),
  // Base URL for self-hosted email asset icons (logo, social icons).
  // When CDN_BASE_URL is set, EmailCDNService uses it; otherwise this provides
  // the fallback absolute URL prefix so email clients always get absolute URLs.
  EMAIL_ASSETS_BASE_URL: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// Keys that must never appear in logs or error output
// ---------------------------------------------------------------------------
const SENSITIVE_KEYS = new Set([
  "DB_PASSWORD",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_SECRET_PREVIOUS",
  "FILE_SIGNING_SECRET",
  "CACHE_KEY_HMAC_SECRET",
  "PII_ENCRYPTION_KEYS",
  "PLATFORM_SECRET_KEY",
  "SMTP_PASS",
  "GMAIL_PASS",
  "SENDGRID_API_KEY",
  "MAILGUN_API_KEY",
  "EMAIL_WEBHOOK_SECRET",
  "FIREBASE_PRIVATE_KEY",
  "VAULT_TOKEN",
  "AWS_SECRET_ID",
  "AWS_SECRET_ACCESS_KEY",
  "ENCRYPTION_KEY",
  "DAILY_API_KEY",
  "ELASTICSEARCH_PASSWORD",
  "ELASTICSEARCH_API_KEY",
  "AGORA_APP_CERTIFICATE",
  "CDN_CLOUDFLARE_API_TOKEN",
  "CDN_FASTLY_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STELLAR_FUNDING_SECRET",
  "TWILIO_AUTH_TOKEN",
]);

// Additional security validations for production
function performSecurityValidation(env: Record<string, any>) {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Production-specific validations
  if (env.NODE_ENV === 'production') {
    // Ensure strong secrets in production
    const requiredSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'FILE_SIGNING_SECRET'];
    for (const secret of requiredSecrets) {
      if (env[secret] && env[secret].length < 64) {
        errors.push(`${secret} must be at least 64 characters in production`);
      }
    }
    
    // Check for default/weak values
    const weakValues = ['password', 'secret', 'key', 'changeme', 'default'];
    for (const [key, value] of Object.entries(env)) {
      if (SENSITIVE_KEYS.has(key) && typeof value === 'string') {
        const lowerValue = value.toLowerCase();
        if (weakValues.some(weak => lowerValue.includes(weak))) {
          errors.push(`${key} appears to contain weak/default values`);
        }
      }
    }
    
    // Ensure HTTPS URLs in production
    const urlFields = ['APP_BASE_URL', 'APP_CLIENT_URL', 'FRONTEND_URL'];
    for (const field of urlFields) {
      if (env[field] && !env[field].startsWith('https://')) {
        warnings.push(`${field} should use HTTPS in production`);
      }
    }
    
    // Check for development/localhost URLs
    const developmentPatterns = [/localhost/, /127\.0\.0\.1/, /0\.0\.0\.0/, /\.local$/];
    for (const field of urlFields) {
      if (env[field] && developmentPatterns.some(pattern => pattern.test(env[field]))) {
        warnings.push(`${field} contains development URL in production environment`);
      }
    }
    
    // Database security
    if (env.DATABASE_URL && !env.DATABASE_URL.includes('ssl=true') && !env.DATABASE_URL.includes('sslmode=require')) {
      warnings.push('DATABASE_URL should enforce SSL in production');
    }
    
    // Redis security
    if (env.REDIS_URL && !env.REDIS_URL.startsWith('rediss://') && env.REDIS_TLS_ENABLED !== 'true') {
      warnings.push('Redis should use TLS in production');
    }
  }
  
  // Log warnings
  if (warnings.length > 0) {
    process.stderr.write(`\nSecurity warnings:\n${warnings.map(w => `  - ${w}`).join('\n')}\n\n`);
  }
  
  // Fail on errors
  if (errors.length > 0) {
    process.stderr.write(`\nSecurity validation errors:\n${errors.map(e => `  - ${e}`).join('\n')}\n\n`);
    process.exit(1);
  }
}

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

  // Perform additional security validation
  performSecurityValidation(result.data);

  return result.data;
}

export const env = validateEnv();
export type Env = typeof env;
export { SENSITIVE_KEYS };
