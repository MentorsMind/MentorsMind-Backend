/**
 * AssetExchangeService
 *
 * Responsibilities:
 *  - Define supported assets (XLM, USDC, PYUSD)
 *  - Fetch live exchange rates from Stellar DEX (SDEX) via Horizon orderbook
 *  - Cache rates in Redis with 60 s TTL; refresh every 60 s via background interval
 *  - Provide payment quotes with slippage calculation
 *  - Validate that a quote's rate hasn't moved > 2 % before execution
 */

import { Asset } from '@stellar/stellar-sdk';
import { server } from '../config/stellar';
import { CacheService } from './cache.service';
import { logger } from '../utils/logger.utils';
import { createError } from '../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_SLIPPAGE_PCT = 1;    // 1 % max slippage enforced on path payments
const RATE_STALE_PCT = 2;             // reject if rate moved > 2 % since quote
const RATE_TTL_SECONDS = 60;          // Redis TTL for exchange rates
const QUOTE_TTL_SECONDS = 120;        // Quotes valid for 2 minutes
const REFRESH_INTERVAL_MS = 60_000;   // Background refresh every 60 s

// ---------------------------------------------------------------------------
// Supported assets
// ---------------------------------------------------------------------------

export interface SupportedAsset {
  code: string;
  issuer: string | null; // null for native XLM
  name: string;
  network: 'mainnet' | 'testnet' | 'both';
}

/**
 * Issuers sourced from official Circle / PayPal Stellar documentation.
 * Testnet issuers are placeholders — replace with real testnet anchors as needed.
 */
export const SUPPORTED_ASSETS: Record<string, SupportedAsset> = {
  XLM: {
    code: 'XLM',
    issuer: null,
    name: 'Stellar Lumens',
    network: 'both',
  },
  USDC: {
    code: 'USDC',
    // Circle's mainnet USDC issuer on Stellar
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    name: 'USD Coin (Circle)',
    network: 'both',
  },
  PYUSD: {
    code: 'PYUSD',
    // PayPal's mainnet PYUSD issuer on Stellar
    issuer: 'GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM',
    name: 'PayPal USD',
    network: 'both',
  },
};

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

const rateKey = (from: string, to: string) => `mm:exchange:rate:${from}:${to}`;
const quoteKey = (quoteId: string) => `mm:exchange:quote:${quoteId}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExchangeRate {
  from: string;
  to: string;
  rate: string;       // how many `to` units per 1 `from` unit
  fetchedAt: string;  // ISO timestamp
}

export interface PaymentQuote {
  quoteId: string;
  from: string;
  to: string;
  sendAmount: string;
  receiveAmount: string;
  rate: string;
  maxSlippagePct: number;
  minReceiveAmount: string;
  expiresAt: string;
  pathPaymentRequired: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStellarAsset(code: string): Asset {
  if (code === 'XLM') return Asset.native();
  const def = SUPPORTED_ASSETS[code];
  if (!def || !def.issuer) throw createError(`Unsupported asset: ${code}`, 400);
  return new Asset(def.code, def.issuer);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const AssetExchangeService = {
  /**
   * Return all supported assets with their current XLM exchange rates.
   */
  async getSupportedAssets(): Promise<Array<SupportedAsset & { xlmRate: string | null }>> {
    const results = await Promise.all(
      Object.values(SUPPORTED_ASSETS).map(async (asset) => {
        let xlmRate: string | null = null;
        if (asset.code !== 'XLM') {
          try {
            const rate = await this.getRate('XLM', asset.code);
            xlmRate = rate.rate;
          } catch {
            // rate unavailable — return null
          }
        }
        return { ...asset, xlmRate };
      }),
    );
    return results;
  },

  /**
   * Fetch (or return cached) exchange rate between two supported assets.
   * Rates are fetched from the Stellar DEX orderbook and cached for 60 s.
   */
  async getRate(from: string, to: string): Promise<ExchangeRate> {
    if (from === to) {
      return { from, to, rate: '1', fetchedAt: new Date().toISOString() };
    }

    this._assertSupported(from);
    this._assertSupported(to);

    const key = rateKey(from, to);
    const cached = await CacheService.get<ExchangeRate>(key);
    if (cached) return cached;

    const rate = await this._fetchRateFromDex(from, to);
    await CacheService.set(key, rate, RATE_TTL_SECONDS);
    return rate;
  },

  /**
   * Build a payment quote for the given from/to/amount.
   * Stores the quote in Redis so it can be validated at execution time.
   */
  async getQuote(from: string, to: string, sendAmount: string): Promise<PaymentQuote> {
    this._assertSupported(from);
    this._assertSupported(to);

    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) throw createError('Invalid send amount', 400);

    const rate = await this.getRate(from, to);
    const receiveAmount = (amount * parseFloat(rate.rate)).toFixed(7);

    // min receive = receiveAmount * (1 - maxSlippage%)
    const minReceive = (parseFloat(receiveAmount) * (1 - MAX_SLIPPAGE_PCT / 100)).toFixed(7);

    const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();
    const quoteId = uuidv4();

    const quote: PaymentQuote = {
      quoteId,
      from,
      to,
      sendAmount,
      receiveAmount,
      rate: rate.rate,
      maxSlippagePct: MAX_SLIPPAGE_PCT,
      minReceiveAmount: minReceive,
      expiresAt,
      pathPaymentRequired: from !== to,
    };

    await CacheService.set(quoteKey(quoteId), quote, QUOTE_TTL_SECONDS);
    return quote;
  },

  /**
   * Validate a quote before executing a payment.
   * Throws if the quote is expired or the live rate has moved > 2 %.
   */
  async validateQuote(quoteId: string): Promise<PaymentQuote> {
    const quote = await CacheService.get<PaymentQuote>(quoteKey(quoteId));
    if (!quote) throw createError('Quote expired or not found', 400);

    if (new Date() > new Date(quote.expiresAt)) {
      throw createError('Quote has expired', 400);
    }

    if (quote.from !== quote.to) {
      const liveRate = await this.getRate(quote.from, quote.to);
      const quoted = parseFloat(quote.rate);
      const live = parseFloat(liveRate.rate);
      const movePct = Math.abs((live - quoted) / quoted) * 100;

      if (movePct > RATE_STALE_PCT) {
        throw createError(
          `Rate moved ${movePct.toFixed(2)}% since quote (max ${RATE_STALE_PCT}%). Please request a new quote.`,
          409,
        );
      }
    }

    return quote;
  },

  /**
   * Resolve a Stellar Asset object for a supported asset code.
   */
  toStellarAsset,

  // ---------------------------------------------------------------------------
  // Background rate refresh
  // ---------------------------------------------------------------------------

  /**
   * Start a background interval that refreshes all cross-asset rates every 60 s.
   * Call once at application startup.
   */
  startRateRefresh(): void {
    const pairs = this._allPairs();
    const refresh = async () => {
      await Promise.allSettled(
        pairs.map(async ([from, to]) => {
          try {
            const rate = await this._fetchRateFromDex(from, to);
            await CacheService.set(rateKey(from, to), rate, RATE_TTL_SECONDS);
            logger.debug('Exchange rate refreshed', { from, to, rate: rate.rate });
          } catch (err) {
            logger.warn('Failed to refresh exchange rate', {
              from,
              to,
              error: err instanceof Error ? err.message : err,
            });
          }
        }),
      );
    };

    // Run immediately, then on interval
    refresh();
    setInterval(refresh, REFRESH_INTERVAL_MS);
    logger.info('AssetExchangeService: rate refresh started', { intervalMs: REFRESH_INTERVAL_MS });
  },

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _assertSupported(code: string): void {
    if (!SUPPORTED_ASSETS[code]) {
      throw createError(`Unsupported asset: ${code}. Supported: ${Object.keys(SUPPORTED_ASSETS).join(', ')}`, 400);
    }
  },

  _allPairs(): Array<[string, string]> {
    const codes = Object.keys(SUPPORTED_ASSETS);
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < codes.length; i++) {
      for (let j = 0; j < codes.length; j++) {
        if (i !== j) pairs.push([codes[i], codes[j]]);
      }
    }
    return pairs;
  },

  async _fetchRateFromDex(from: string, to: string): Promise<ExchangeRate> {
    const selling = toStellarAsset(from);
    const buying = toStellarAsset(to);

    // Fetch the top of the orderbook — best ask price
    const orderbook = await (server as any)
      .orderbook(selling, buying)
      .limit(1)
      .call();

    const asks: Array<{ price: string; amount: string }> = orderbook.asks ?? [];

    if (!asks.length) {
      throw createError(`No liquidity found on SDEX for ${from}/${to}`, 503);
    }

    return {
      from,
      to,
      rate: asks[0].price,
      fetchedAt: new Date().toISOString(),
    };
  },
};
