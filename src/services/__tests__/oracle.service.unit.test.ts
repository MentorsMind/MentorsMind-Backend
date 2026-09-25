/**
 * Unit tests for OracleService circuit-breaker handling.
 *
 * Covers every oracle failure mode described in issue #994:
 *  1. Contract panic — "not enough feeders"  (MIN_FEEDERS quorum not met)
 *  2. Contract panic — stale prices (STALE_SECS = 300 exceeded)
 *  3. Contract panic — TWAP circuit-breaker (50 % deviation, DEFAULT_CB_THRESHOLD_BPS = 5_000)
 *  4. Contract panic — "no TWAP available" (< 2 price submissions)
 *  5. Non-contract error (network / RPC timeout) — passed through unchanged
 *  6. Successful fetch updates last-known-good (LKG) cache
 *  7. LKG fallback is served when contract panics and cache is fresh
 *  8. LKG fallback is rejected when cache exceeds 10-minute maximum staleness
 *  9. Degraded-mode flag is set on contract error and cleared on recovery
 * 10. fetchPriceFromContract wraps contract panics in OracleUnavailableError
 * 11. isContractError correctly classifies error messages
 * 12. Health integration — oracle component reports "degraded" when isDegraded
 */

import {
  OracleService,
  OracleUnavailableError,
  isContractError,
  LKG_MAX_STALENESS_MS,
  ORACLE_PRICE_TTL_SECONDS,
} from '../oracle.service';
import { CacheService } from '../cache.service';
import { ErrorCode } from '../../errors/error-codes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../cache.service');
jest.mock('../../utils/logger.utils', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../utils/error.utils', () => ({
  logWarning: jest.fn(),
}));

// Mock the StellarOracleClient constructor by overriding env var and injecting
// a test client via OracleService.setClient().
jest.mock('@stellar/stellar-sdk', () => ({}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrice(overrides: Partial<ReturnType<typeof defaultPrice>> = {}) {
  return {
    asset: 'XLM',
    price: '0.1234567',
    twap: '0.1234000',
    isStale: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function defaultPrice() {
  return makePrice();
}

function makeContractClient(overrides: {
  getPrice?: jest.Mock;
  getTwap?: jest.Mock;
  isPriceStale?: jest.Mock;
} = {}) {
  return {
    getPrice: overrides.getPrice ?? jest.fn().mockResolvedValue({ price: BigInt(1234567), updatedAt: Math.floor(Date.now() / 1000) }),
    getTwap: overrides.getTwap ?? jest.fn().mockResolvedValue(BigInt(1234000)),
    isPriceStale: overrides.isPriceStale ?? jest.fn().mockResolvedValue(false),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OracleService', () => {
  const ORACLE_ADDR = 'C_TEST_CONTRACT_ADDRESS';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SOROBAN_ORACLE_CONTRACT_ADDRESS = ORACLE_ADDR;
    // Reset degraded mode by injecting a healthy client.
    OracleService.setClient(makeContractClient());
  });

  afterEach(() => {
    delete process.env.SOROBAN_ORACLE_CONTRACT_ADDRESS;
  });

  // ─── isContractError ───────────────────────────────────────────────────────

  describe('isContractError', () => {
    const contractMessages = [
      'not enough feeders',
      'no prices',
      'no TWAP available — need at least 2 price submissions',
      'price deviation exceeds circuit breaker threshold',
      'stale price detected',
      'unauthorized feeder',
    ];

    it.each(contractMessages)('returns true for contract panic: "%s"', (msg) => {
      expect(isContractError(new Error(msg))).toBe(true);
    });

    it('returns false for generic network errors', () => {
      expect(isContractError(new Error('ECONNREFUSED: connection refused'))).toBe(false);
      expect(isContractError(new Error('timeout'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isContractError('not enough feeders')).toBe(false);
      expect(isContractError(null)).toBe(false);
    });
  });

  // ─── OracleUnavailableError ────────────────────────────────────────────────

  describe('OracleUnavailableError', () => {
    it('carries the expected code and properties', () => {
      const err = new OracleUnavailableError('not enough feeders', false);
      expect(err.code).toBe(ErrorCode.ORACLE_UNAVAILABLE);
      expect(err.statusCode).toBe(503);
      expect(err.isOperational).toBe(true);
      expect(err.usedFallback).toBe(false);
      expect(err.contractError).toBe('not enough feeders');
      expect(err instanceof OracleUnavailableError).toBe(true);
    });

    it('marks usedFallback correctly', () => {
      const err = new OracleUnavailableError('stale', true);
      expect(err.usedFallback).toBe(true);
      expect(err.message).toContain('last-known-good');
    });
  });

  // ─── fetchPriceFromContract ────────────────────────────────────────────────

  describe('fetchPriceFromContract', () => {
    it('wraps "not enough feeders" panic in OracleUnavailableError (failure mode 1)', async () => {
      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));

      await expect(OracleService.fetchPriceFromContract('XLM'))
        .rejects.toBeInstanceOf(OracleUnavailableError);
    });

    it('wraps stale price panic in OracleUnavailableError (failure mode 2)', async () => {
      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('stale price detected')),
      }));

      await expect(OracleService.fetchPriceFromContract('XLM'))
        .rejects.toBeInstanceOf(OracleUnavailableError);
    });

    it('wraps TWAP circuit-breaker panic in OracleUnavailableError (failure mode 3)', async () => {
      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(
          new Error('price deviation exceeds circuit breaker threshold'),
        ),
      }));

      await expect(OracleService.fetchPriceFromContract('XLM'))
        .rejects.toBeInstanceOf(OracleUnavailableError);
    });

    it('wraps "no TWAP available" panic in OracleUnavailableError (failure mode 4)', async () => {
      OracleService.setClient(makeContractClient({
        getTwap: jest.fn().mockRejectedValue(new Error('no TWAP available — need at least 2 price submissions')),
        // isPriceStale must also panic for this to propagate; use getPrice failure instead:
        getPrice: jest.fn().mockRejectedValue(new Error('no TWAP available — need at least 2 price submissions')),
      }));

      await expect(OracleService.fetchPriceFromContract('XLM'))
        .rejects.toBeInstanceOf(OracleUnavailableError);
    });

    it('passes through non-contract errors unchanged (failure mode 5)', async () => {
      const networkErr = new Error('ECONNREFUSED');
      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(networkErr),
      }));

      await expect(OracleService.fetchPriceFromContract('XLM'))
        .rejects.toThrow('ECONNREFUSED');

      // Ensure it is NOT wrapped as OracleUnavailableError
      const rejection = OracleService.fetchPriceFromContract('XLM').catch((e) => e);
      expect(await rejection).not.toBeInstanceOf(OracleUnavailableError);
    });

    it('returns a valid OraclePrice on success', async () => {
      OracleService.setClient(makeContractClient());

      // Bypass cache for a direct contract call
      const result = await OracleService.fetchPriceFromContract('XLM');
      expect(result.asset).toBe('XLM');
      expect(typeof result.price).toBe('string');
      expect(typeof result.twap).toBe('string');
      expect(typeof result.isStale).toBe('boolean');
    });
  });

  // ─── getPrice — LKG cache fallback ────────────────────────────────────────

  describe('getPrice', () => {
    it('returns fresh price and updates LKG cache on success (failure mode 6)', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null); // no short-TTL cache hit
      OracleService.setClient(makeContractClient());

      const result = await OracleService.getPrice('XLM');

      expect(result.asset).toBe('XLM');
      // LKG set call: first call sets short-TTL, second sets LKG key
      expect(CacheService.set).toHaveBeenCalledTimes(2);
      expect(result.fromFallback).toBeUndefined();
    });

    it('serves LKG price when contract panics and cache is fresh (failure mode 7)', async () => {
      const lkgEntry = {
        price: makePrice({ price: '0.1111111' }),
        cachedAt: Date.now() - 60_000, // 1 minute old — within 10-min window
      };

      // First get: short-TTL cache miss; second get: LKG hit
      (CacheService.get as jest.Mock)
        .mockResolvedValueOnce(null) // short-TTL cache
        .mockResolvedValueOnce(lkgEntry); // LKG cache

      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));

      const result = await OracleService.getPrice('XLM');

      expect(result.price).toBe('0.1111111');
      expect(result.fromFallback).toBe(true);
    });

    it('throws OracleUnavailableError when LKG cache exceeds 10-minute staleness (failure mode 8)', async () => {
      const staleEntry = {
        price: makePrice(),
        cachedAt: Date.now() - (LKG_MAX_STALENESS_MS + 1_000), // 11 minutes old
      };

      (CacheService.get as jest.Mock)
        .mockResolvedValueOnce(null)       // short-TTL cache miss
        .mockResolvedValueOnce(staleEntry); // LKG cache — but too old

      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));

      await expect(OracleService.getPrice('XLM'))
        .rejects.toBeInstanceOf(OracleUnavailableError);
    });

    it('throws OracleUnavailableError when LKG cache is empty and contract panics', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null); // both cache misses

      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));

      await expect(OracleService.getPrice('XLM'))
        .rejects.toBeInstanceOf(OracleUnavailableError);
    });

    it('throws ORACLE_NOT_CONFIGURED when contract address is missing', async () => {
      delete process.env.SOROBAN_ORACLE_CONTRACT_ADDRESS;

      const err = await OracleService.getPrice('XLM').catch((e) => e);
      expect(err.code).toBe(ErrorCode.ORACLE_NOT_CONFIGURED);
    });

    it('sets degraded mode on contract failure (failure mode 9)', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);

      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));

      await OracleService.getPrice('XLM').catch(() => {});
      expect(OracleService.isDegraded).toBe(true);
    });

    it('clears degraded mode on successful recovery (failure mode 9 — recovery)', async () => {
      // First call: contract panics → degraded
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));
      await OracleService.getPrice('XLM').catch(() => {});
      expect(OracleService.isDegraded).toBe(true);

      // Second call: contract recovers → healthy
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      OracleService.setClient(makeContractClient()); // healthy client
      await OracleService.getPrice('XLM');
      expect(OracleService.isDegraded).toBe(false);
    });

    it('returns short-TTL cached price directly without hitting the contract', async () => {
      const cachedPrice = makePrice({ price: '0.9999999' });
      (CacheService.get as jest.Mock).mockResolvedValueOnce(cachedPrice);

      const mockGetPrice = jest.fn();
      OracleService.setClient(makeContractClient({ getPrice: mockGetPrice }));

      const result = await OracleService.getPrice('XLM');
      expect(result.price).toBe('0.9999999');
      expect(mockGetPrice).not.toHaveBeenCalled();
    });
  });

  // ─── Health integration ────────────────────────────────────────────────────

  describe('isDegraded / degradedReason (health check integration)', () => {
    it('isDegraded is false when oracle is healthy', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      OracleService.setClient(makeContractClient());
      await OracleService.getPrice('XLM');

      expect(OracleService.isDegraded).toBe(false);
      expect(OracleService.degradedReason).toBe('');
    });

    it('degradedReason reflects the contract error message', async () => {
      (CacheService.get as jest.Mock).mockResolvedValue(null);
      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));

      await OracleService.getPrice('XLM').catch(() => {});
      expect(OracleService.degradedReason).toContain('not enough feeders');
    });

    it('LKG fallback price carries fromFallback=true', async () => {
      const lkgEntry = {
        price: makePrice(),
        cachedAt: Date.now() - 30_000,
      };
      (CacheService.get as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(lkgEntry);

      OracleService.setClient(makeContractClient({
        getPrice: jest.fn().mockRejectedValue(new Error('not enough feeders')),
      }));

      const price = await OracleService.getPrice('XLM');
      expect(price.fromFallback).toBe(true);
    });
  });
});
