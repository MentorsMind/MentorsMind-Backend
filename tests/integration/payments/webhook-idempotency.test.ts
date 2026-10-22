/**
 * Integration tests for PaymentsService.handleWebhook idempotency.
 *
 * Runs against a real PostgreSQL (testcontainers, or TEST_DATABASE_URL when
 * Docker is unavailable) with seeded pending payments. Only the Stellar
 * Horizon lookups, socket emission and logger are mocked.
 *
 * The schema below is the subset of `transactions` / `bookings` the webhook
 * touches. The UNIQUE constraint on stellar_tx_hash (the last line of defence)
 * is declared exactly as migrations 003 / 082 do, and a test asserts those
 * migrations really contain it.
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

let mockPool: Pool;

jest.mock('../../../src/config/database', () => ({
  __esModule: true,
  default: {
    query: (...args: unknown[]) => (mockPool.query as any)(...args),
    connect: () => mockPool.connect(),
  },
}));

// uuid@13 is ESM-only and cannot be loaded by jest's CJS runtime
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

jest.mock('../../../src/utils/logger.utils', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../src/middleware/errorHandler', () => ({
  createError: jest.fn((code: string) => Object.assign(new Error(code), { code })),
}));

const mockGetTransaction = jest.fn();
const mockGetTransactionOperations = jest.fn();
jest.mock('../../../src/services/stellar.service', () => ({
  stellarService: {
    getTransaction: (...a: unknown[]) => mockGetTransaction(...a),
    getTransactionOperations: (...a: unknown[]) => mockGetTransactionOperations(...a),
  },
}));

jest.mock('../../../src/services/socket.service', () => ({
  SocketService: { emitToUser: jest.fn() },
}));

import { PaymentsService } from '../../../src/services/payments.service';
import { SocketService } from '../../../src/services/socket.service';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');

const USER_ID = '11111111-1111-1111-1111-111111111111';
const PAYMENT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PAYMENT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BOOKING_A = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0';
const BOOKING_B = 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0';
const DEST_A = 'GDESTA'.padEnd(56, 'A'); // Stellar addresses are 56 chars
const DEST_B = 'GDESTB'.padEnd(56, 'B');
const HASH_1 = 'a'.repeat(64);
const HASH_2 = 'b'.repeat(64);

const webhook = (hash: string, to: string) => ({
  type: 'transaction',
  transaction_hash: hash,
  to,
  amount: '10.0000000',
});

let container: { stop: () => Promise<unknown> } | undefined;

async function createPool(): Promise<Pool> {
  if (process.env.TEST_DATABASE_URL) {
    return new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 10 });
  }
  const { GenericContainer, Wait } = await import('testcontainers');
  const started = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  container = started;
  return new Pool({
    host: started.getHost(),
    port: started.getMappedPort(5432),
    user: 'test',
    password: 'test',
    database: 'test',
    max: 10,
  });
}

async function createSchema(pool: Pool): Promise<void> {
  await pool.query(`
    DROP TABLE IF EXISTS transactions, bookings CASCADE;

    CREATE TABLE bookings (
      id UUID PRIMARY KEY,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      stellar_tx_hash VARCHAR(64),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE transactions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      booking_id UUID,
      type TEXT NOT NULL DEFAULT 'payment',
      status TEXT NOT NULL DEFAULT 'pending',
      amount DECIMAL(20, 7) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'XLM',
      asset_type VARCHAR(20) DEFAULT 'native',
      asset_code VARCHAR(12),
      asset_issuer VARCHAR(56),
      to_address VARCHAR(56),
      payment_rail VARCHAR(32),
      external_reference VARCHAR(255),
      stellar_tx_hash VARCHAR(64),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT transactions_stellar_tx_hash_key UNIQUE (stellar_tx_hash)
    );
  `);
}

async function seedPendingPayments(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE transactions, bookings');
  await pool.query(
    `INSERT INTO bookings (id) VALUES ($1), ($2)`,
    [BOOKING_A, BOOKING_B],
  );
  await pool.query(
    `INSERT INTO transactions (id, user_id, booking_id, amount, to_address, created_at)
     VALUES ($1, $2, $3, '10.0000000', $4, NOW() - INTERVAL '2 minutes'),
            ($5, $2, $6, '10.0000000', $7, NOW() - INTERVAL '1 minute')`,
    [PAYMENT_A, USER_ID, BOOKING_A, DEST_A, PAYMENT_B, BOOKING_B, DEST_B],
  );
}

const completedPayments = async () =>
  (await mockPool.query(
    `SELECT id, stellar_tx_hash FROM transactions WHERE status = 'completed' ORDER BY id`,
  )).rows;

describe('PaymentsService.handleWebhook idempotency (integration)', () => {
  beforeAll(async () => {
    mockPool = await createPool();
    await createSchema(mockPool);
  });

  afterAll(async () => {
    await mockPool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await seedPendingPayments(mockPool);

    // Horizon: every hash is a successful tx with one matching native payment op
    mockGetTransaction.mockResolvedValue({ successful: true });
    mockGetTransactionOperations.mockImplementation(async () => [
      { type: 'payment', amount: '10.0000000', to: DEST_A, asset_type: 'native' },
      { type: 'payment', amount: '10.0000000', to: DEST_B, asset_type: 'native' },
    ]);
  });

  it('schema guard: migrations declare UNIQUE on transactions.stellar_tx_hash', () => {
    const create = fs.readFileSync(path.join(MIGRATIONS_DIR, '003_create_transactions.sql'), 'utf8');
    const unique = fs.readFileSync(path.join(MIGRATIONS_DIR, '082_stellar_tx_hash_unique.sql'), 'utf8');

    expect(create).toMatch(/stellar_tx_hash\s+VARCHAR\(64\)\s+UNIQUE/i);
    expect(unique).toMatch(/transactions_stellar_tx_hash_key\s+UNIQUE\s*\(stellar_tx_hash\)/i);
  });

  it('the database rejects a second payment with an already-used stellar_tx_hash', async () => {
    await mockPool.query(`UPDATE transactions SET stellar_tx_hash = $1 WHERE id = $2`, [HASH_1, PAYMENT_A]);

    await expect(
      mockPool.query(`UPDATE transactions SET stellar_tx_hash = $1 WHERE id = $2`, [HASH_1, PAYMENT_B]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('same tx hash delivered sequentially twice → one payment completed, second is skipped', async () => {
    const first = await PaymentsService.handleWebhook(webhook(HASH_1, DEST_A));
    const second = await PaymentsService.handleWebhook(webhook(HASH_1, DEST_A));

    expect(first.processed).toBe(true);
    expect(second).toEqual({ processed: false, message: 'Transaction hash already processed' });

    expect(await completedPayments()).toEqual([{ id: PAYMENT_A, stellar_tx_hash: HASH_1 }]);
    expect(SocketService.emitToUser).toHaveBeenCalledTimes(1);
  });

  it('same tx hash delivered concurrently → only one payment transitions to completed', async () => {
    const results = await Promise.allSettled([
      PaymentsService.handleWebhook(webhook(HASH_1, DEST_A)),
      PaymentsService.handleWebhook(webhook(HASH_1, DEST_A)),
    ]);

    // Neither delivery may blow up the caller (a webhook retry must stay a no-op)
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);

    // Exactly one delivery wins; the duplicate must not repeat side effects
    const processed = results.map((r) => (r as PromiseFulfilledResult<{ processed: boolean }>).value.processed);
    expect(processed.filter(Boolean)).toHaveLength(1);
    expect(SocketService.emitToUser).toHaveBeenCalledTimes(1);

    // Exactly one payment is completed, with that hash, and the other stays pending
    expect(await completedPayments()).toEqual([{ id: PAYMENT_A, stellar_tx_hash: HASH_1 }]);
    const { rows: pending } = await mockPool.query(`SELECT id FROM transactions WHERE status = 'pending'`);
    expect(pending).toEqual([{ id: PAYMENT_B }]);

    // The hash is stored on exactly one row and one booking is marked paid
    const { rows: hashRows } = await mockPool.query(
      `SELECT count(*)::int AS n FROM transactions WHERE stellar_tx_hash = $1`,
      [HASH_1],
    );
    expect(hashRows[0].n).toBe(1);
    const { rows: paidBookings } = await mockPool.query(`SELECT id FROM bookings WHERE payment_status = 'paid'`);
    expect(paidBookings).toEqual([{ id: BOOKING_A }]);
  });

  it('different tx hashes delivered concurrently → two separate payments completed', async () => {
    const [a, b] = await Promise.all([
      PaymentsService.handleWebhook(webhook(HASH_1, DEST_A)),
      PaymentsService.handleWebhook(webhook(HASH_2, DEST_B)),
    ]);

    expect(a.processed).toBe(true);
    expect(b.processed).toBe(true);

    expect(await completedPayments()).toEqual([
      { id: PAYMENT_A, stellar_tx_hash: HASH_1 },
      { id: PAYMENT_B, stellar_tx_hash: HASH_2 },
    ]);
    const { rows } = await mockPool.query(`SELECT id FROM bookings WHERE payment_status = 'paid' ORDER BY id`);
    expect(rows).toEqual([{ id: BOOKING_A }, { id: BOOKING_B }]);
  });
});
