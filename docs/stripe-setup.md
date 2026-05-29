# Stripe Setup

This document describes how to enable Stripe as an alternative payment method in MentorMinds.

1. Create a Stripe account and obtain your **Secret Key** and **Webhook Signing Secret**.
2. Set environment variables in your deployment:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

3. Install optional dependency:

```bash
npm install stripe
```

4. Expose webhook endpoint to Stripe: `POST /api/v1/payments/stripe/webhook`.
   - Use the `STRIPE_WEBHOOK_SECRET` to verify incoming events.
   - Configure endpoint to receive events: `payment_intent.succeeded`, `charge.succeeded`, `charge.refunded`.

5. Client integration:
   - Create a PaymentIntent via `POST /api/v1/payments/stripe/create-intent` with `bookingId`, `amount`, and `currency`.
   - Use the returned `clientSecret` to complete payment on the frontend using Stripe.js.

6. Refunds:
   - Use `POST /api/v1/payments/stripe/refund` with `chargeId` (and optional `amount`) to trigger a refund via Stripe.

7. Converting to Stellar escrow:
   - When Stripe confirms payments via webhook, the backend records the transaction and creates an `escrows` record.
   - A follow-up job should convert Stripe-held balances to Stellar payments using platform flows (not automated here).

Notes

- The service expects `bookingId` and `userId` in PaymentIntent metadata so when Stripe confirms a payment we can link it to a booking and user.
- For production use, consider implementing idempotency and retry semantics for webhook handling and robust error handling around currency conversions.
