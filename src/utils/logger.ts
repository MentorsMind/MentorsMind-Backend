import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

// ---------------------------------------------------------------------------
// Sensitive-field redaction
// ---------------------------------------------------------------------------
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'secretKey',
  'authorization',
  'refreshToken',
  'apiKey',
  'privateKey',
]);

export function redactSensitiveFields(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveFields(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitiveFields(value, depth + 1);
    }
  }
  return result;
}

const redactionFormat = winston.format((info) => {
  // Redact any extra metadata attached to the log entry
  const { level, message, timestamp, correlationId, ...rest } = info as any;
  const redacted = redactSensitiveFields(rest) as Record<string, unknown>;
  return {
    level,
    message,
    timestamp,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...redacted,
  } as any;
});

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------
const developmentFormat = winston.format.combine(
  redactionFormat(),
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, correlationId, ...meta }) => {
    const corrId = correlationId ? ` [${correlationId}]` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp}${corrId} ${level}: ${message}${metaStr}`;
  }),
);

const productionFormat = winston.format.combine(
  redactionFormat(),
  winston.format.timestamp(),
  winston.format.json(),
);

// ---------------------------------------------------------------------------
// Log level from env
// ---------------------------------------------------------------------------
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as string;
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || 'logs';
const LOG_MAX_SIZE = process.env.LOG_MAX_SIZE || '20m';
const LOG_MAX_FILES = process.env.LOG_MAX_FILES || '14d';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test';

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
const transports: winston.transport[] = [];

// Console transport — suppressed in test to keep Jest output clean;
// tests can spy on the logger methods directly.
if (!IS_TEST) {
  transports.push(
    new winston.transports.Console({
      format: IS_PRODUCTION ? productionFormat : developmentFormat,
    }),
  );
}

// File transports — production only
if (IS_PRODUCTION) {
  transports.push(
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      format: productionFormat,
    }),
    new DailyRotateFile({
      filename: path.join(LOG_FILE_PATH, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: LOG_MAX_SIZE,
      maxFiles: LOG_MAX_FILES,
      format: productionFormat,
    }),
  );
}

// ---------------------------------------------------------------------------
// Winston logger instance
// ---------------------------------------------------------------------------
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  levels: winston.config.npm.levels,
  transports,
  // Never exit on uncaught exceptions within the logger itself
  exitOnError: false,
});

// ---------------------------------------------------------------------------
// Child-logger helper — use this to attach a correlationId to every log entry
// inside a request context without overriding the global instance.
// ---------------------------------------------------------------------------
export function withCorrelationId(correlationId: string): winston.Logger {
  return logger.child({ correlationId });
}
