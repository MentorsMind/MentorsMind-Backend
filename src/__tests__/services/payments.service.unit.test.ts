import { PaymentsService } from '../../services/payments.service';
import pool from '../../config/database';
import { BookingModel } from '../../models/booking.model';
import { stellarService } from '../../services/stellar.service';
import { SocketService } from '../../services/socket.service';
import { mockDeep, mockReset } from 'jest-mock-extended';

// Mock external dependencies
jest.mock('../../config/database');
jest.mock('../../models/booking.model');
jest.mock('../../services/stellar.service');
jest.mock('../../services/socket.service');

const mockPool = pool as jest.Mocked<typeof pool>;
const mockBookingModel = BookingModel as jest.Mocked<typeof BookingModel>;
const mockStellarService = stellarService as jest.Mocked<typeof stellarService>;
const mockSocketService = SocketService as jest.Mocked<typeof SocketService>;

describe('PaymentsService', () => {
  beforeEach(() => {
    mockReset(mockPool);
    mockReset(mockBookingModel);
    mockReset(mockStellarService);
    mockReset(mockSocketService);
  });

  describe('initiatePayment', () => {
    it('should initiate payment successfully', async () => {
      const data = {
        userId: 'user-123',
        bookingId: 'booking-123',
        amount: '50.0000000',
        currency: 'XLM',
        description: 'Mentoring session payment',
      };

      const mockBooking = {
        id: data.bookingId,
        mentee_id: data.userId,
        payment_status: 'pending',
      };

      const mockPayment = {
        id: 'payment-123',
        user_id: data.userId,
        booking_id: data.bookingId,
        type: 'payment',
        status: 'pending',
        amount: data.amount,
        currency: data.currency,
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);
      mockPool.query.mockResolvedValue({ rows: [mockPayment] });

      const result = await PaymentsService.initiatePayment(data);

      expect(result).toEqual(mockPayment);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.any(Array)
      );
    });

    it('should throw error if booking not found', async () => {
      const data = {
        userId: 'user-123',
        bookingId: 'nonexistent',
        amount: '50.0000000',
      };

      mockBookingModel.findById.mockResolvedValue(null);

      await expect(PaymentsService.initiatePayment(data)).rejects.toThrow('Booking not found');
    });

    it('should throw error if user does not own booking', async () => {
      const data = {
        userId: 'user-123',
        bookingId: 'booking-123',
        amount: '50.0000000',
      };

      const mockBooking = {
        id: data.bookingId,
        mentee_id: 'other-user',
        payment_status: 'pending',
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);

      await expect(PaymentsService.initiatePayment(data)).rejects.toThrow('Access denied');
    });

    it('should throw error if booking already paid', async () => {
      const data = {
        userId: 'user-123',
        bookingId: 'booking-123',
        amount: '50.0000000',
      };

      const mockBooking = {
        id: data.bookingId,
        mentee_id: data.userId,
        payment_status: 'paid',
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);

      await expect(PaymentsService.initiatePayment(data)).rejects.toThrow('Booking is already paid');
    });
  });

  describe('getPaymentById', () => {
    it('should return payment if found', async () => {
      const paymentId = 'payment-123';
      const userId = 'user-123';

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: 'pending',
      };

      mockPool.query.mockResolvedValue({ rows: [mockPayment] });

      const result = await PaymentsService.getPaymentById(paymentId, userId);

      expect(result).toEqual(mockPayment);
    });

    it('should throw error if payment not found', async () => {
      const paymentId = 'nonexistent';
      const userId = 'user-123';

      mockPool.query.mockResolvedValue({ rows: [] });

      await expect(PaymentsService.getPaymentById(paymentId, userId)).rejects.toThrow('Payment not found');
    });
  });

  describe('getPaymentStatus', () => {
    it('should return payment status', async () => {
      const paymentId = 'payment-123';
      const userId = 'user-123';

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: 'completed',
        stellar_tx_hash: 'hash123',
        updated_at: new Date(),
      };

      jest.spyOn(PaymentsService, 'getPaymentById').mockResolvedValue(mockPayment as any);

      const result = await PaymentsService.getPaymentStatus(paymentId, userId);

      expect(result).toEqual({
        id: paymentId,
        status: 'completed',
        stellarTxHash: 'hash123',
        updatedAt: mockPayment.updated_at,
      });
    });
  });

  describe('confirmPayment', () => {
    it('should confirm payment successfully', async () => {
      const paymentId = 'payment-123';
      const userId = 'user-123';
      const stellarTxHash = 'hash123';

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: 'pending',
        booking_id: 'booking-123',
        from_address: 'GABC...',
      };

      const mockUpdatedPayment = { ...mockPayment, status: 'completed', stellar_tx_hash: stellarTxHash };

      jest.spyOn(PaymentsService, 'getPaymentById').mockResolvedValue(mockPayment as any);
      mockStellarService.getAccount.mockResolvedValue({ id: 'GABC...' } as any);
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockUpdatedPayment] })
        .mockResolvedValueOnce({}) // booking update
        .mockResolvedValueOnce({}); // socket emit
      mockSocketService.emitToUser.mockResolvedValue();

      const result = await PaymentsService.confirmPayment(paymentId, userId, stellarTxHash);

      expect(result).toEqual(mockUpdatedPayment);
      expect(mockSocketService.emitToUser).toHaveBeenCalled();
    });

    it('should throw error if payment already confirmed', async () => {
      const paymentId = 'payment-123';
      const userId = 'user-123';
      const stellarTxHash = 'hash123';

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: 'completed',
      };

      jest.spyOn(PaymentsService, 'getPaymentById').mockResolvedValue(mockPayment as any);

      await expect(PaymentsService.confirmPayment(paymentId, userId, stellarTxHash)).rejects.toThrow('Payment already confirmed');
    });
  });

  describe('listUserPayments', () => {
    it('should return paginated payments', async () => {
      const userId = 'user-123';
      const filters = { page: 1, limit: 10, status: 'completed' as const };

      const mockPayments = [
        { id: 'payment-1', user_id: userId, status: 'completed' },
        { id: 'payment-2', user_id: userId, status: 'completed' },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockPayments })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const result = await PaymentsService.listUserPayments(userId, filters);

      expect(result.payments).toEqual(mockPayments);
      expect(result.total).toBe(2);
    });
  });

  describe('getPaymentHistory', () => {
    it('should return payment history with total volume', async () => {
      const userId = 'user-123';
      const filters = { page: 1, limit: 10 };

      const mockPayments = [{ id: 'payment-1', status: 'completed' }];
      const mockVolume = { total_volume: '150.0000000' };

      jest.spyOn(PaymentsService, 'listUserPayments').mockResolvedValue({
        payments: mockPayments,
        total: 1,
      });
      mockPool.query.mockResolvedValue({ rows: [mockVolume] });

      const result = await PaymentsService.getPaymentHistory(userId, filters);

      expect(result.payments).toEqual(mockPayments);
      expect(result.total).toBe(1);
      expect(result.totalVolume).toBe('150.0000000');
    });
  });

  describe('refundPayment', () => {
    it('should refund payment successfully', async () => {
      const paymentId = 'payment-123';
      const userId = 'user-123';
      const reason = 'Customer request';

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: 'completed',
        booking_id: 'booking-123',
        amount: '50.0000000',
        currency: 'XLM',
      };

      const mockRefundedPayment = { ...mockPayment, status: 'refunded' };

      jest.spyOn(PaymentsService, 'getPaymentById').mockResolvedValue(mockPayment as any);

      const mockClient = {
        query: jest.fn(),
        connect: jest.fn(),
        release: jest.fn(),
      };
      mockPool.connect.mockResolvedValue(mockClient as any);
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [mockRefundedPayment] }) // UPDATE original
        .mockResolvedValueOnce() // INSERT refund
        .mockResolvedValueOnce() // UPDATE booking
        .mockResolvedValueOnce(); // COMMIT

      const result = await PaymentsService.refundPayment(paymentId, userId, reason);

      expect(result).toEqual(mockRefundedPayment);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw error if payment already refunded', async () => {
      const paymentId = 'payment-123';
      const userId = 'user-123';

      const mockPayment = {
        id: paymentId,
        user_id: userId,
        status: 'refunded',
      };

      jest.spyOn(PaymentsService, 'getPaymentById').mockResolvedValue(mockPayment as any);

      await expect(PaymentsService.refundPayment(paymentId, userId)).rejects.toThrow('Payment already refunded');
    });
  });

  describe('handleWebhook', () => {
    it('should process webhook successfully', async () => {
      const payload = {
        type: 'payment_received',
        transaction_hash: 'hash123',
        from: 'GABC...',
        to: 'GXYZ...',
        amount: '50.0000000',
      };

      const mockPayment = {
        id: 'payment-123',
        status: 'pending',
        booking_id: 'booking-123',
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [mockPayment] }) // find payment
        .mockResolvedValueOnce({}) // update payment
        .mockResolvedValueOnce({}); // update booking

      const result = await PaymentsService.handleWebhook(payload);

      expect(result).toEqual({
        processed: true,
        message: 'Payment confirmed via webhook',
      });
    });

    it('should return not processed if no transaction hash', async () => {
      const payload = {
        type: 'payment_received',
        amount: '50.0000000',
      };

      const result = await PaymentsService.handleWebhook(payload);

      expect(result).toEqual({
        processed: false,
        message: 'No transaction hash provided',
      });
    });

    it('should return not processed if no matching payment', async () => {
      const payload = {
        type: 'payment_received',
        transaction_hash: 'hash123',
        amount: '50.0000000',
      };

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await PaymentsService.handleWebhook(payload);

      expect(result).toEqual({
        processed: false,
        message: 'No matching payment found',
      });
    });
  });
});