import * as StellarSdk from '@stellar/stellar-sdk';
import { env } from './env';
import config from './index';
import { logger } from '../utils/logger';

/**
 * Stellar Network Configuration
 *
 * Network selection:
 *   Set `STELLAR_NETWORK=testnet` or `STELLAR_NETWORK=mainnet` in `.env`.
 *   The Horizon server URL defaults to the public SDF endpoint for the chosen
 *   network but can be overridden with `STELLAR_HORIZON_URL`.
 *
 * Failover:
 *   `horizonUrls.primary` — used for all calls first.
 *   `horizonUrls.backup`  — tried when primary is unreachable (after retries).
 *   To use a custom backup, update the `HORIZON_URLS` map below.
 *
 * Platform wallet:
 *   `PLATFORM_SECRET_KEY` is read on-demand via `getPlatformKeypair()`.
 *   It is never stored in the exported config object.
 */

// ---------------------------------------------------------------------------
// Network constants
// ---------------------------------------------------------------------------

const HORIZON_URLS: Record<string, { primary: string; backup: string }> = {
  testnet: {
    primary: 'https://horizon-testnet.stellar.org',
    backup: 'https://horizon-testnet.stellar.org', // only one public testnet
  },
  mainnet: {
    primary: 'https://horizon.stellar.org',
    backup: 'https://horizon.stellar.org',
  },
};

const networkKey = config.stellar.network === 'mainnet' ? 'mainnet' : 'testnet';

export const horizonUrls = {
  primary: config.stellar.horizonUrl || HORIZON_URLS[networkKey].primary,
  backup: HORIZON_URLS[networkKey].backup,
};

export const server = new StellarSdk.Horizon.Server(horizonUrls.primary);
export const backupServer = new StellarSdk.Horizon.Server(horizonUrls.backup);

export const networkPassphrase =
  config.stellar.network === 'testnet'
    ? StellarSdk.Networks.TESTNET
    : StellarSdk.Networks.PUBLIC;

// ---------------------------------------------------------------------------
// Platform keypair helper
// ---------------------------------------------------------------------------

// Secret key is read directly from env — never stored in the config object
export const getPlatformKeypair = (): StellarSdk.Keypair | null => {
  const secretKey = env.PLATFORM_SECRET_KEY;
  if (!secretKey) {
    logger.warn('Platform secret key not configured');
    return null;
  }
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
    logger.error('Stellar connection failed', { error: error instanceof Error ? error.message : error });
    return false;
  }
};

export { StellarSdk };
