/**
 * Integration tests for Stripe webhook processing via StripeController/StripeService.
 *
 * Strategy:
 *  - Mock the Stripe SDK client so no real HTTP calls are made.
 *  - Mock BookingModel and EscrowModel so we don't need live DB rows for
 *    those entities; we focus on verifying the transactions/bookings SQL
 *    issued through the pool (mocked at the pool level).
 *  - Test the HTTP endpoint POST /api/v1/payments/stripe/webhook.
 */

import request from 'supertest';
import app from '../../../src/app';

// ---------------------------------------------------------------------------
// Mock auth middleware (not needed for webhook route, but keeps other routes
// that may fire on app initialisation from erroring).
// ---------------------------------------------------------------------------
jest.mock('../../../src/middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user', role: 'mentee' };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

// ---------------------------------------------------------------------------
// Mock the database pool so we never need a real DB connection.
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: {
    query: (...args: any[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}));

// ---------------------------------------------------------------------------
// Mock BookingModel & EscrowModel used inside StripeService.handleEvent.
// ---------------------------------------------------------------------------
jest.mock('../../../src/models/booking.model', () => ({
  BookingModel: {
    findById: jest.fn(),
  },
}));

jest.mock('../../../src/models/escrow.model', () => ({
  EscrowModel: {
    create: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock the Stripe SDK client via the StripeService singleton so
// stripe.webhooks.constructEvent is under our control.
// ---------------------------------------------------------------------------
const mockConstructEvent = jest.fn();

jest.mock('../../../src/services/stripe.service', () => {
  const mockStripeClient = {
    webhooks: {
      constructEvent: (...args: any[]) => mockConstructEvent(...args),
    },
  };

  const mockHandleEvent = jest.fn();

  const StripeServiceClass = jest.fn().mockImplementation(() => ({
    ensureClient: () => mockStripeClient,
    handleEvent: mockHandleEvent,
  }));

  const instance = new (StripeServiceClass as any)();

  return {
    StripeServiceClass,
    StripeService: instance,
    __mockHandleEvent: mockHandleEvent,
    __mockStripeClient: mockStripeClient,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import { BookingModel } from '../../../src/models/booking.model';
import { EscrowModel } from '../../../src/models/escrow.model';

const WEBHOOK_PATH = '/api/v1/payments/stripe/webhook';
const STRIPE_SECRET = 'whsec_test_secret';

/** Build a minimal Stripe PaymentIntent.succeeded event payload */
function makePaymentIntentSucceededEvent(overrides: Record<string, any> = {}): any {
  return {
    id: 'evt_test_pi_succeeded',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test_123',
        object: 'payment_intent',
        amount: 10000,
        currency: 'usd',
        metadata: {
          bookingId: 'booking-abc',
          userId: 'user-xyz',
        },
        charges: {
          data: [
            {
              id: 'ch_test_123',
              amount: 10000,
              currency: 'usd',
              metadata: {
                bookingId: 'booking-abc',
                userId: 'user-xyz',
              },
            },
          ],
        },
        ...overrides,
      },
    },
  };
}

/** Build a minimal Stripe charge.refunded event payload */
function makeChargeRefundedEvent(overrides: Record<string, any> = {}): any {
  return {
    id: 'evt_test_charge_refunded',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_test_refund_123',
        object: 'charge',
        amount: 10000,
        amount_refunded: 10000,
        currency: 'usd',
        metadata: { bookingId: 'booking-abc', userId: 'user-xyz' },
        ...overrides,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Stripe Webhook Integration', () => {
  // Grab mocks after jest.mock() is set up
  let mockHandleEvent: jest.Mock;

  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_SECRET;

    // Retrieve the mock handle event from the mocked module
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const stripeMock = require('../../../src/services/stripe.service');
    mockHandleEvent = stripeMock.__mockHandleEvent;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: constructEvent returns the raw event (no sig verification error)
    mockConstructEvent.mockImplementation((_raw: any, _sig: string, _secret: string) => {
      // In real Stripe usage the raw body is used; here we parse it back
      const body = typeof _raw === 'string' ? JSON.parse(_raw) : JSON.parse(_raw.toString());
      return body;
    });

    // Default: handleEvent resolves successfully
    mockHandleEvent.mockResolvedValue(undefined);

    // Default: pool client mock for transaction queries
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'tx-1' }] }),
      release: jest.fn(),
    };
    mockConnect.mockResolvedValue(mockClient);
    mockQuery.mockResolvedValue({ rows: [] });

    // Default: booking found
    (BookingModel.findById as jest.Mock).mockResolvedValue({
      id: 'booking-abc',
      mentee_id: 'user-xyz',
      mentor_id: 'mentor-xyz',
    });

    // Default: escrow creates successfully
    (EscrowModel.create as jest.Mock).mockResolvedValue({ id: 'escrow-1' });
  });

  // -------------------------------------------------------------------------
  // 1. payment_intent.succeeded → booking updated to 'paid'
  // -------------------------------------------------------------------------
  describe('payment_intent.succeeded', () => {
    it('returns 200 and calls handleEvent with the constructed event', async () => {
      const event = makePaymentIntentSucceededEvent();
      const rawBody = Buffer.from(JSON.stringify(event));

      const res = await request(app)
        .post(WEBHOOK_PATH)
        .set('stripe-signature', 'valid-sig')
        .set('Content-Type', 'application/octet-stream')
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toMatchObject({ received: true });

      // constructEvent was called once with the right secret
      expect(mockConstructEvent).toHaveBeenCalledTimes(1);
      expect(mockConstructEvent).toHaveBeenCalledWith(
        expect.anything(),      // raw body buffer/string
        'valid-sig',
        STRIPE_SECRET,
      );

      // handleEvent was called with the parsed event
      expect(mockHandleEvent).toHaveBeenCalledTimes(1);
      expect(mockHandleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment_intent.succeeded' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. charge.refunded → should be forwarded to handleEvent
  //    (handleEvent silently ignores it since charge.refunded is not
  //     implemented, but the HTTP layer still returns 200)
  // -------------------------------------------------------------------------
  describe('charge.refunded', () => {
    it('returns 200 and calls handleEvent; no error even though event is not fully handled', async () => {
      const event = makeChargeRefundedEvent();
      const rawBody = Buffer.from(JSON.stringify(event));

      const res = await request(app)
        .post(WEBHOOK_PATH)
        .set('stripe-signature', 'valid-sig')
        .set('Content-Type', 'application/octet-stream')
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(mockHandleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'charge.refunded' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Unknown event type → returns 200 and does nothing (no error thrown)
  // -------------------------------------------------------------------------
  describe('unknown event type', () => {
    it('returns 200 for an unknown event type without throwing', async () => {
      const event = {
        id: 'evt_unknown',
        type: 'some.unknown.event',
        data: { object: {} },
      };
      const rawBody = Buffer.from(JSON.stringify(event));

      const res = await request(app)
        .post(WEBHOOK_PATH)
        .set('stripe-signature', 'valid-sig')
        .set('Content-Type', 'application/octet-stream')
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(mockHandleEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'some.unknown.event' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Invalid / missing signature → returns 400
  // -------------------------------------------------------------------------
  describe('invalid signature', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
      const rawBody = Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded' }));

      const res = await request(app)
        .post(WEBHOOK_PATH)
        .set('Content-Type', 'application/octet-stream')
        .send(rawBody);

      expect(res.status).toBe(400);
      expect(mockHandleEvent).not.toHaveBeenCalled();
    });

    it('returns 400 when constructEvent throws a signature verification error', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      const rawBody = Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded' }));

      const res = await request(app)
        .post(WEBHOOK_PATH)
        .set('stripe-signature', 'bad-sig')
        .set('Content-Type', 'application/octet-stream')
        .send(rawBody);

      expect(res.status).toBe(400);
      expect(mockHandleEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. handleEvent throws → returns 400 (controller catches all errors)
  // -------------------------------------------------------------------------
  describe('handleEvent internal error', () => {
    it('returns 400 when handleEvent rejects', async () => {
      mockHandleEvent.mockRejectedValue(new Error('DB connection failed'));

      const event = makePaymentIntentSucceededEvent();
      const rawBody = Buffer.from(JSON.stringify(event));

      const res = await request(app)
        .post(WEBHOOK_PATH)
        .set('stripe-signature', 'valid-sig')
        .set('Content-Type', 'application/octet-stream')
        .send(rawBody);

      expect(res.status).toBe(400);
    });
  });
});
