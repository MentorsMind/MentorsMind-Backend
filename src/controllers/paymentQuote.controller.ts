// @ts-nocheck
/**
 * PaymentQuote Controller
 *
 * GET /api/v1/payments/assets        — list supported assets with XLM rates
 * GET /api/v1/payments/quote         — get a payment quote with slippage info
 */

import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { AssetExchangeService } from '../services/assetExchange.service';
import { ResponseUtil } from '../utils/response.utils';
import { createError } from '../middleware/errorHandler';

export const PaymentQuoteController = {
  /** GET /api/v1/payments/assets */
  async getSupportedAssets(_req: Request, res: Response): Promise<void> {
    const assets = await AssetExchangeService.getSupportedAssets();
    ResponseUtil.success(res, assets, 'Supported assets retrieved successfully');
  },

  /**
   * GET /api/v1/payments/quote?from=XLM&to=USDC&amount=50
   *
   * Query params:
   *   from   — source asset code (XLM | USDC | PYUSD)
   *   to     — destination asset code
   *   amount — amount of `from` asset to send
   */
  async getQuote(req: Request, res: Response): Promise<void> {
    const { from, to, amount } = req.query as Record<string, string>;

    if (!from || !to || !amount) {
      throw createError('Query params from, to, and amount are required', 400);
    }

    const quote = await AssetExchangeService.getQuote(
      from.toUpperCase(),
      to.toUpperCase(),
      amount,
    );

    ResponseUtil.success(res, quote, 'Payment quote generated successfully');
  },
};
