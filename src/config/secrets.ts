/**
 * secrets.ts
 *
 * Fetches runtime secrets from AWS Secrets Manager or HashiCorp Vault on
 * startup, then merges them into process.env so the rest of the app reads
 * them transparently via src/config/env.ts.
 *
 * Provider selection (SECRETS_PROVIDER env var):
 *   "aws"   — AWS Secrets Manager (production default)
 *   "vault" — HashiCorp Vault
 *   "env"   — plain environment variables (development / CI fallback)
 *
 * JWT rotation:
 *   The provider returns both JWT_SECRET (current) and JWT_SECRET_PREVIOUS
 *   (previous). Auth middleware should accept tokens signed with either key
 *   during the rotation window.
 */

import { logger } from "../utils/logger";

export type SecretsProvider = "aws" | "vault" | "env";

/** Shape of the secret bundle returned by any provider. */
export interface AppSecrets {
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  /** Previous JWT secret — valid during key rotation, may be undefined. */
  JWT_SECRET_PREVIOUS?: string;
  DB_PASSWORD: string;
  SMTP_PASS?: string;
  PLATFORM_SECRET_KEY?: string;
  PII_ENCRYPTION_KEYS?: string;
  PII_ENCRYPTION_CURRENT_KEY_VERSION?: string;
}

let cachedSecrets: AppSecrets | null = null;

// ---------------------------------------------------------------------------
// AWS Secrets Manager
// ---------------------------------------------------------------------------
async function fetchFromAws(secretId: string): Promise<AppSecrets> {
  // Lazy-require so the package is only needed in production
  const { SecretsManagerClient, GetSecretValueCommand } =
    await import("@aws-sdk/client-secrets-manager");

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );

  const raw = response.SecretString;
  if (!raw) throw new Error(`AWS secret "${secretId}" has no SecretString`);

  return JSON.parse(raw) as AppSecrets;
}

// ---------------------------------------------------------------------------
// HashiCorp Vault
// ---------------------------------------------------------------------------
async function fetchFromVault(
  vaultAddr: string,
  vaultToken: string,
  secretPath: string,
): Promise<AppSecrets> {
  const { default: fetch } = await import("node-fetch");

  const res = await (fetch as any)(`${vaultAddr}/v1/${secretPath}`, {
    headers: { "X-Vault-Token": vaultToken },
  });

  if (!res.ok) {
    throw new Error(`Vault responded ${res.status} for path "${secretPath}"`);
  }

  const json = (await res.json()) as { data: { data: AppSecrets } };
  // KV v2 nests under data.data; KV v1 is data directly
  return (json.data?.data ?? json.data) as AppSecrets;
}

function getEnvSecrets(): AppSecrets {
  return {
    JWT_SECRET: process.env.JWT_SECRET || "",
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "",
    JWT_SECRET_PREVIOUS: process.env.JWT_SECRET_PREVIOUS,
    DB_PASSWORD: process.env.DB_PASSWORD || "",
    SMTP_PASS: process.env.SMTP_PASS,
    PLATFORM_SECRET_KEY: process.env.PLATFORM_SECRET_KEY,
    PII_ENCRYPTION_KEYS: process.env.PII_ENCRYPTION_KEYS,
    PII_ENCRYPTION_CURRENT_KEY_VERSION:
      process.env.PII_ENCRYPTION_CURRENT_KEY_VERSION,
  };
}

export async function resolveAppSecrets(forceRefresh = false): Promise<AppSecrets> {
  if (!forceRefresh && cachedSecrets) {
    return cachedSecrets;
  }

  const provider = (process.env.SECRETS_PROVIDER || "env") as SecretsProvider;

  if (provider === "env") {
    cachedSecrets = getEnvSecrets();
    return cachedSecrets;
  }

  let secrets: AppSecrets;

  if (provider === "aws") {
    const secretId = process.env.AWS_SECRET_ID;
    if (!secretId) {
      throw new Error("AWS_SECRET_ID is required when SECRETS_PROVIDER=aws");
    }
    secrets = await fetchFromAws(secretId);
  } else if (provider === "vault") {
    const vaultAddr = process.env.VAULT_ADDR;
    const vaultToken = process.env.VAULT_TOKEN;
    const secretPath = process.env.VAULT_SECRET_PATH;
    if (!vaultAddr || !vaultToken || !secretPath) {
      throw new Error(
        "VAULT_ADDR, VAULT_TOKEN, and VAULT_SECRET_PATH are required when SECRETS_PROVIDER=vault",
      );
    }
    secrets = await fetchFromVault(vaultAddr, vaultToken, secretPath);
  } else {
    throw new Error(`Unknown SECRETS_PROVIDER: "${provider}"`);
  }

  cachedSecrets = secrets;
  return secrets;
}

// ---------------------------------------------------------------------------
// Public: loadSecrets
// ---------------------------------------------------------------------------

/**
 * Loads secrets from the configured provider and merges them into
 * process.env.  Call this once at the very start of server.ts, before
 * src/config/env.ts is evaluated.
 *
 * Falls back to plain env vars if the provider is unavailable and
 * NODE_ENV !== 'production' (fail-open for dev/staging convenience).
 */
export async function loadSecrets(): Promise<void> {
  const provider = (process.env.SECRETS_PROVIDER || "env") as SecretsProvider;

  if (provider === "env") {
    logger.debug("Secrets provider: env (using process.env directly)");
    return;
  }

  try {
    const secrets = await resolveAppSecrets(true);

    // Merge into process.env — only overwrite if the secret is non-empty
    const SENSITIVE_KEYS: (keyof AppSecrets)[] = [
      "JWT_SECRET",
      "JWT_REFRESH_SECRET",
      "JWT_SECRET_PREVIOUS",
      "DB_PASSWORD",
      "SMTP_PASS",
      "PLATFORM_SECRET_KEY",
      "PII_ENCRYPTION_KEYS",
      "PII_ENCRYPTION_CURRENT_KEY_VERSION",
    ];

    for (const key of SENSITIVE_KEYS) {
      const value = secrets[key];
      if (value) {
        process.env[key] = value;
      }
    }

    logger.info("Secrets loaded successfully");
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      // Hard fail in production — never start with missing secrets
      logger.error({ err }, "Failed to load secrets from provider — aborting");
      process.exit(1);
    } else {
      // Warn and fall back to env vars in dev/staging
      logger.warn(
        { err },
        "Secrets provider unavailable — falling back to env vars",
      );
    }
  }
}
