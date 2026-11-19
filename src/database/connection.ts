import type { PoolConfig } from "pg";

export interface DatabaseConnectionSettings {
  url: string;
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  poolMax: number;
  poolMin: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
}

/** Return a connection URL that is safe to include in diagnostics. */
export function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = "REDACTED";
    if (url.username) url.username = "REDACTED";
    return url.toString();
  } catch {
    // Keep malformed values from leaking credentials in an error path.
    return connectionString.replace(
      /:\/\/([^:@/]+)(?::([^@/]*))?@/,
      "://REDACTED:REDACTED@",
    );
  }
}

function getCertificateAuthority(): string | undefined {
  const ca = process.env.DB_SSL_CA;
  return ca ? ca.replace(/\\n/g, "\n") : undefined;
}

/** Build a PostgreSQL configuration with TLS and bounded connection reuse. */
export function createSecurePoolConfig(
  settings: DatabaseConnectionSettings,
): PoolConfig {
  const ca = getCertificateAuthority();

  return {
    connectionString: settings.url,
    host: settings.host,
    port: settings.port,
    database: settings.name,
    user: settings.user,
    password: settings.password,
    ssl: {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
    },
    max: settings.poolMax,
    min: settings.poolMin,
    idleTimeoutMillis: settings.idleTimeoutMs,
    connectionTimeoutMillis: settings.connectionTimeoutMs,
    statement_timeout: settings.statementTimeoutMs,
    query_timeout: settings.statementTimeoutMs,
    allowExitOnIdle: false,
    // Rotate long-lived connections to reduce exposure from leaked sessions.
    maxUses: 10_000,
  };
}