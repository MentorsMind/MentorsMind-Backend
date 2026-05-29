// @ts-nocheck
/**
 * Payments Controller
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { PaymentsService, PaymentStatus, PaymentType } from '../services/payments.service';
import { ResponseUtil } from '../utils/response.utils';
import { InitiatePaymentInput, ConfirmPaymentInput, ListPaymentsQuery } from '../validators/schemas/payments.schemas';
import { AuditLogService, extractIpAddress } from '../services/auditLog.service';

export const PaymentsController = {
  /** POST /api/v1/payments */
  async initiatePayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { bookingId, amount, currency, description, fromAddress, toAddress, quoteId } = req.body as InitiatePaymentInput;

    const payment = await PaymentsService.initiatePayment({
      userId,
      bookingId,
      amount,
      currency,
      description,
      fromAddress,
      toAddress,
      quoteId,
    });

    // Log payment initiation
    await AuditLogService.log({
      userId,
      action: 'PAYMENT_INITIATED',
      resourceType: 'payment',
      resourceId: payment.id,
      newValue: { 
        amount, 
        currency, 
        bookingId, 
        status: payment.status 
      },
      ipAddress: extractIpAddress(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      metadata: { fromAddress, toAddress },
    });

    ResponseUtil.created(res, payment, 'Payment initiated successfully');
  },

  /** GET /api/v1/payments/:id */
  async getPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const payment = await PaymentsService.getPaymentById(id, userId);
    ResponseUtil.success(res, payment, 'Payment retrieved successfully');
  },

  /** GET /api/v1/payments/:id/status */
  async getPaymentStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const status = await PaymentsService.getPaymentStatus(id, userId);
    ResponseUtil.success(res, status, 'Payment status retrieved successfully');
  },

  /** POST /api/v1/payments/:id/confirm */
  async confirmPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { stellarTxHash } = req.body as ConfirmPaymentInput;

    const payment = await PaymentsService.confirmPayment(id, userId, stellarTxHash);
    
    // Log payment confirmation
    await AuditLogService.log({
      userId,
      action: 'PAYMENT_CONFIRMED',
      resourceType: 'payment',
      resourceId: id,
      newValue: { status: payment.status, stellarTxHash },
      ipAddress: extractIpAddress(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    
    ResponseUtil.success(res, payment, 'Payment confirmed successfully');
  },

  /** GET /api/v1/payments */
  async listPayments(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { cursor, limit, status, type, from, to } = req.query as unknown as ListPaymentsQuery;

    const result = await PaymentsService.listUserPayments(userId, {
      cursor,
      limit,
      status: status as PaymentStatus | undefined,
      type: type as PaymentType | undefined,
      from,
      to,
    });

    ResponseUtil.success(res, {
      data: result.payments,
      next_cursor: result.next_cursor,
      has_more: result.has_more,
      total: result.total,
    }, 'Payments retrieved successfully');
  },

  /** POST /api/v1/payments/:id/refund */
  async refundPayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { reason, stellarTxHash } = req.body ?? {};

    const payment = await PaymentsService.refundPayment(id, userId, reason, stellarTxHash);
    
    // Log payment refund
    await AuditLogService.log({
      userId,
      action: 'PAYMENT_REFUNDED',
      resourceType: 'payment',
      resourceId: id,
      newValue: { status: payment.status, reason, stellarTxHash },
      ipAddress: extractIpAddress(req),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
    
    ResponseUtil.success(res, payment, 'Payment refunded successfully');
  },

  /** GET /api/v1/payments/history */
  async getPaymentHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { cursor, limit, from, to } = req.query as unknown as ListPaymentsQuery;

    const result = await PaymentsService.getPaymentHistory(userId, { cursor, limit, from, to });

    ResponseUtil.success(
      res,
      {
        data: result.payments,
        totalVolume: result.totalVolume,
        next_cursor: result.next_cursor,
        has_more: result.has_more,
        total: result.total,
      },
      'Payment history retrieved successfully',
    );
  },

  /** POST /api/v1/payments/webhook */
  async handleWebhook(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await PaymentsService.handleWebhook(req.body);
    ResponseUtil.success(res, result, result.message);
  },
};
