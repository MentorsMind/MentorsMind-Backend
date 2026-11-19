import { PaymentsService } from '../payments.service';
import { AssetExchangeService } from '../assetExchange.service';
import { pool } from '../../config/database';
import { BookingModel } from '../../models/booking.model';
import { createError } from '../../middleware/errorHandler';
import { ErrorCode } from '../../errors/error-codes';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));
jest.mock('../assetExchange.service');
jest.mock('../models/booking.model');
jest.mock('../../middleware/errorHandler');
jest.mock('../../config/env', () => ({
  env: {
    PLATFORM_FEE_PERCENTAGE: '5',
    PLATFORM_PUBLIC_KEY: 'G123',
  }
}));

const mockedPoolQuery = pool.query as jest.Mock;
const mockedAssetExchangeValidateQuote = AssetExchangeService.validateQuote as jest.Mock;

describe('PaymentsService Quote Expiry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initiatePayment with quote', () => {
    it('proceeds with valid quote (< 30s old)', async () => {
      const validQuote = {
        quoteId: 'quote-1',
        from: 'XLM',
        to: 'USDC',
        rate: '0.5',
        expiresAt: new Date(Date.now() + 10000), // 10 seconds from now
        pathPaymentRequired: false,
      };

      ;(BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'user-1',
        payment_status: 'pending',
      });
      ;(LoyaltyService.getDiscountBps as jest.Mock).mockResolvedValue(0);
      ;(AssetExchangeService.validateQuote as jest.Mock).mockResolvedValue(validQuote);
      mockedPoolQuery.mockResolvedValue({ rows: [{ id: 'payment-1' }] });

      const result = await PaymentsService.initiatePayment({
        userId: 'user-1',
        bookingId: 'booking-1',
        amount: '100',
        currency: 'XLM',
        quoteId: 'quote-1',
      });

      expect(result.id).toBe('payment-1');
      expect(mockedPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.any(Array)
      );
    });

    it('throws AppError for expired quote (> 30s old)', async () => {
      const expiredQuote = {
        quoteId: 'quote-2',
        from: 'XLM',
        to: 'USDC',
        rate: '0.5',
        expiresAt: new Date(Date.now() - 10000), // 10 seconds ago
        pathPaymentRequired: false,
      };

      ;(BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'user-1',
        payment_status: 'pending',
      });
      ;(LoyaltyService.getDiscountBps as jest.Mock).mockResolvedValue(0);
      ;(AssetExchangeService.validateQuote as jest.Mock).mockResolvedValue(expiredQuote);

      await expect(PaymentsService.initiatePayment({
        userId: 'user-1',
        bookingId: 'booking-1',
        amount: '100',
        currency: 'XLM',
        quoteId: 'quote-2',
      })).rejects.toThrow('Quote has expired or is invalid');
    });

    it('proceeds without quote validation when quoteId is not provided', async () => {
      ;(BookingModel.findById as jest.Mock).mockResolvedValue({
        id: 'booking-1',
        mentee_id: 'user-1',
        payment_status: 'pending',
      });
      ;(LoyaltyService.getDiscountBps as jest.Mock).mockResolvedValue(0);
      ;(AssetExchangeService.validateQuote as jest.Mock).mockResolvedValue(null);
      mockedPoolQuery.mockResolvedValue({ rows: [{ id: 'payment-1' }] });

      const result = await PaymentsService.initiatePayment({
        userId: 'user-1',
        bookingId: 'booking-1',
        amount: '100',
        currency: 'XLM',
        // no quoteId
      });

      expect(result.id).toBe('payment-1');
    });
  });
});