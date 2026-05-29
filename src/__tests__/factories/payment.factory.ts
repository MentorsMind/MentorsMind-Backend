/**
 * Payment test factory.
 *
 * Schema reference: database/migrations/003_create_transactions.sql
 *
 * Creates a row in the `transactions` table.  A user is created automatically
 * when `userId` is not supplied.
 */
import { faker } from "@faker-js/faker";
import { testPool } from "../setup/testDb";
import { createUser, UserRecord } from "./user.factory";

export type TransactionStatus = "pending" | "completed" | "failed" | "refunded";
export type TransactionType = "deposit" | "withdrawal" | "payment" | "payout";

export interface PaymentRecord {
  id: string;
  user_id: string;
  amount: string;
  currency: string;
  status: TransactionStatus;
  stellar_tx_hash: string | null;
  type: TransactionType;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentOverrides {
  userId?: string;
  amount?: number;
  currency?: string;
  type?: TransactionType;
  status?: TransactionStatus;
  stellarTxHash?: string | null;
}

export interface PaymentWithUser {
  payment: PaymentRecord;
  user: UserRecord;
}

export function generateStellarTxHash(): string {
  return faker.string.hexadecimal({ length: 64, casing: "lower", prefix: "" });
}

export async function createPayment(
  overrides: PaymentOverrides = {},
): Promise<PaymentWithUser> {
  const user = overrides.userId
    ? await fetchUser(overrides.userId)
    : await createUser();

  const amount =
    overrides.amount ?? parseFloat(faker.finance.amount({ min: 1, max: 1000 }));
  const stellarTxHash =
    overrides.stellarTxHash !== undefined
      ? overrides.stellarTxHash
      : generateStellarTxHash();

  const { rows } = await testPool.query<PaymentRecord>(
    `INSERT INTO transactions
       (user_id, amount, currency, status, stellar_tx_hash, type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      user.id,
      amount.toFixed(7),
      overrides.currency ?? "XLM",
      overrides.status ?? "completed",
      stellarTxHash,
      overrides.type ?? "payment",
    ],
  );

  return { payment: rows[0], user };
}

export async function createDeposit(
  userId: string,
  amount = 100,
): Promise<PaymentRecord> {
  const { payment } = await createPayment({
    userId,
    amount,
    type: "deposit",
    status: "completed",
  });
  return payment;
}

export async function createWithdrawal(
  userId: string,
  amount = 50,
): Promise<PaymentRecord> {
  const { payment } = await createPayment({
    userId,
    amount,
    type: "withdrawal",
    status: "pending",
  });
  return payment;
}

/** Bulk-create payments, each optionally tied to the same user. */
export async function createPayments(
  count: number,
  overrides: PaymentOverrides = {},
): Promise<PaymentWithUser[]> {
  return Promise.all(
    Array.from({ length: count }, () => createPayment(overrides)),
  );
}

async function fetchUser(id: string): Promise<UserRecord> {
  const { rows } = await testPool.query<UserRecord>(
    "SELECT * FROM users WHERE id = $1",
    [id],
  );
  if (!rows[0]) throw new Error(`User not found: ${id}`);
  return rows[0];
}
