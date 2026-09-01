import * as StellarSdk from "@stellar/stellar-sdk";
import { env } from "./env";
import config from "./index";
import { logger } from "../utils/logger";
import { traceStore } from '../middleware/tracing.middleware';

/**
 * Stellar Network Configuration
 */

const HORIZON_URLS: Record<string, { primary: string; backup: string }> = {
  testnet: {
    primary: "https://horizon-testnet.stellar.org",
    backup: "https://horizon-testnet.stellar.org",
  },
  mainnet: {
    primary: "https://horizon.stellar.org",
    backup: "https://horizon.stellar.org",
  },
};

const networkKey = config.stellar.network === "mainnet" ? "mainnet" : "testnet";

export const horizonUrls = {
  primary: config.stellar.horizonUrl || HORIZON_URLS[networkKey].primary,
  backup: HORIZON_URLS[networkKey].backup,
};

// ─── Custom Fetch with Tracing ────────────────────────────────────────────────
/**
 * A fetch wrapper that injects tracing headers from the current AsyncLocalStorage context.
 */
const tracingFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const context = traceStore.getStore();
  const headers = new Headers(init?.headers);
  
  if (context) {
    headers.set('X-Request-ID', context.requestId);
    headers.set('X-Correlation-ID', context.correlationId);
  }

  return fetch(input, { ...init, headers });
};

export const server = new StellarSdk.Horizon.Server(horizonUrls.primary, { fetch: tracingFetch } as any);
export const backupServer = new StellarSdk.Horizon.Server(horizonUrls.backup, { fetch: tracingFetch } as any);

export const networkPassphrase =
  config.stellar.network === "testnet"
    ? StellarSdk.Networks.TESTNET
    : StellarSdk.Networks.PUBLIC;

// ---------------------------------------------------------------------------
// Platform keypair helper
// ---------------------------------------------------------------------------

export const getPlatformKeypair = (): StellarSdk.Keypair | null => {
  const secretKey = env.STELLAR_FUNDING_SECRET;
  if (!secretKey) {
    logger.warn("Platform secret key not configured");
    return null;
  }

  // Prefer HSM-backed signing. When the HSM is enabled (aws_cloudhsm or
  // pkcs11 provider), the private key must NOT be materialised in process
  // memory from an env var. In that case we return null here — callers must
  // use `HsmStellarSigner.signStellarTransaction` instead, which delegates
  // the actual Ed25519 signature to the HSM token.
  try {
    const hsmConfig = require("./hsm.config").default;
    if (hsmConfig.enabled) {
      logger.info(
        { provider: hsmConfig.provider },
        "HSM is enabled — deferring Stellar signing to HSM-backed signer",
      );
      return null;
    }
  } catch {
    // hsm config module unavailable — fall through to env-based keypair.
  }

  // Development fallback: only reachable when HSM is disabled AND we are in a
  // development/test environment. The HsmStellarSigner enforces the env guard.
  logger.warn(
    "⚠️  HSM NOT ENABLED — constructing platform keypair from PLAINTEXT " +
      "STEALLAR_FUNDING_SECRET. This is only acceptable in development.",
  );
  return StellarSdk.Keypair.fromSecret(secretKey);
};

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export const testStellarConnection = async (): Promise<boolean> => {
  try {
    await server.ledgers().limit(1).call();
    logger.info(`Stellar ${config.stellar.network} connected successfully`);
    return true;
  } catch (error) {
    logger.error("Stellar connection failed", {
      error: error instanceof Error ? error.message : error,
    });
    return false;
  }
};

export { StellarSdk };
