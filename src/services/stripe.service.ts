import Stripe from 'stripe';
import config from '../config';
import { logger } from '../utils/logger';
import pool from '../config/database';
import { BookingModel } from '../models/booking.model';
import { EscrowModel } from '../models/escrow.model';

const stripeSecret = process.env.STRIPE_SECRET_KEY || config.env.STRIPE_SECRET_KEY;

export class StripeServiceClass {
  private stripe?: Stripe;

  constructor() {
    if (stripeSecret) {
      this.stripe = new Stripe(stripeSecret, { apiVersion: '2023-08-16' } as any);
    }
  }

  ensureClient(): Stripe {
    if (!this.stripe) throw new Error('Stripe client not configured (STRIPE_SECRET_KEY missing)');
    return this.stripe;
  }

  async createPaymentIntent(amountCents: number, currency: string, metadata: Record<string, string>) {
    const stripe = this.ensureClient();
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: currency.toLowerCase(),
      metadata,
      capture_method: 'automatic',
    });
    return pi;
  }

  async createRefund(chargeId: string, amountCents?: number) {
    const stripe = this.ensureClient();
    const refund = await stripe.refunds.create({ charge: chargeId, amount: amountCents });
    return refund;
  }

  /**
   * Handle Stripe webhook event (event already constructed/verified by controller).
   * For successful payments we create a transaction and an escrow record and link to booking.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    try {
      logger.info('Stripe event received', { type: event.type });

      if (event.type === 'payment_intent.succeeded' || event.type === 'charge.succeeded') {
        const pi = (event.type === 'payment_intent.succeeded') ? event.data.object as Stripe.PaymentIntent : undefined;
        const ch = (event.type === 'charge.succeeded') ? event.data.object as Stripe.Charge : undefined;

        const charge = ch ?? (pi?.charges?.data && pi.charges.data[0]) ?? null;
        if (!charge) {
          logger.warn('Stripe event has no charge', { eventId: event.id });
          return;
        }

        // Metadata: expect bookingId and userId to be present when we created the PaymentIntent
        const metadata = (pi && pi.metadata) || (charge && (charge.metadata as Record<string,string>)) || {};
        const bookingId = metadata.bookingId;
        const userId = metadata.userId;

        if (!bookingId || !userId) {
          logger.warn('Stripe charge missing metadata.bookingId or metadata.userId, skipping', { chargeId: charge.id });
          return;
        }

        // Convert amount in cents to decimal string
        const amount = ((charge.amount ?? 0) / 100).toFixed(7);
        const currency = (charge.currency || 'USD').toUpperCase();

        // Insert transaction record
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const insertTx = `INSERT INTO transactions (user_id, booking_id, type, status, amount, currency, description, created_at, updated_at)
            VALUES ($1, $2, 'payment', 'completed', $3, $4, $5, NOW(), NOW()) RETURNING id`;
          const desc = `stripe_charge:${charge.id}`;
          const { rows } = await client.query(insertTx, [userId, bookingId, amount, currency, desc]);
          const transactionId = rows[0].id;

          // Mark booking as paid and link transaction
          await client.query(`UPDATE bookings SET payment_status = 'paid', transaction_id = $2, updated_at = NOW() WHERE id = $1`, [bookingId, transactionId]);

          // Create escrow record to hold funds until converted to Stellar — use learner/mentor from booking
          const booking = await BookingModel.findById(bookingId);
          if (!booking) {
            logger.warn('Booking not found for Stripe payment', { bookingId });
          } else {
            await EscrowModel.create({
              learnerId: booking.mentee_id,
              mentorId: booking.mentor_id,
              amount: amount,
              currency: currency,
              description: `Stripe charge ${charge.id}`,
            });
          }

          await client.query('COMMIT');
          logger.info('Stripe payment recorded and escrow created', { chargeId: charge.id, transactionId });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }
    } catch (err: any) {
      logger.error('Failed to handle Stripe event', { err: err.message, eventId: (event && event.id) || null });
      throw err;
    }
  }
}

export const StripeService = new StripeServiceClass();
