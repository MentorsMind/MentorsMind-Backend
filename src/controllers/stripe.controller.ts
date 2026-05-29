import { Request, Response } from 'express';
import { ResponseUtil } from '../utils/response.utils';
import { StripeService } from '../services/stripe.service';
import { logger } from '../utils/logger';
import rawBody from 'raw-body';
import config from '../config';

export const StripeController = {
  async createPaymentIntent(req: Request, res: Response) {
    try {
      const { bookingId, amount, currency } = req.body;
      const cents = Math.round(parseFloat(amount) * 100);
      const metadata = { bookingId, userId: req.body.userId };
      const pi = await StripeService.createPaymentIntent(cents, currency || 'USD', metadata);
      return ResponseUtil.success(res, { clientSecret: pi.client_secret, id: pi.id }, 'PaymentIntent created');
    } catch (err: any) {
      logger.error('Stripe createPaymentIntent error', { err: err.message });
      return ResponseUtil.error(res, 'Failed to create payment intent', 500);
    }
  },

  async createRefund(req: Request, res: Response) {
    try {
      const { chargeId, amount } = req.body;
      const cents = amount ? Math.round(parseFloat(amount) * 100) : undefined;
      const refund = await StripeService.createRefund(chargeId, cents);
      return ResponseUtil.success(res, refund, 'Refund created');
    } catch (err: any) {
      logger.error('Stripe createRefund error', { err: err.message });
      return ResponseUtil.error(res, 'Failed to create refund', 500);
    }
  },

  async webhook(req: Request, res: Response) {
    const stripeSigningSecret = config.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    try {
      // Need raw body to verify signature
      const raw = (req as any).rawBody || (await rawBody(req));
      const sig = req.headers['stripe-signature'] as string | undefined;
      if (!sig || !stripeSigningSecret) {
        logger.warn('Stripe webhook missing signature or secret');
        return ResponseUtil.error(res, 'Webhook signature missing or not configured', 400);
      }

      const stripe = (StripeService as any).ensureClient ? (StripeService as any).ensureClient() : null;
      if (!stripe) throw new Error('Stripe client not configured');

      const event = stripe.webhooks.constructEvent(raw, sig, stripeSigningSecret);
      await StripeService.handleEvent(event);
      return ResponseUtil.success(res, { received: true }, 'Event processed');
    } catch (err: any) {
      logger.error('Stripe webhook verification failed', { err: err.message });
      return ResponseUtil.error(res, 'Webhook verification failed', 400);
    }
  }
};
