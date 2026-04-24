import { PoolClient } from 'pg';
import { pool } from '../config/database';

interface WhitelistEntry {
  tableName: string;
  whereColumn: string;
}

const DELETION_WHITELIST: WhitelistEntry[] = [
  { tableName: 'users', whereColumn: 'id' },
  { tableName: 'profiles', whereColumn: 'user_id' },
  { tableName: 'sessions', whereColumn: 'user_id' },
  { tableName: 'refresh_tokens', whereColumn: 'user_id' },
  { tableName: 'bookings', whereColumn: 'mentee_id' },
  { tableName: 'bookings', whereColumn: 'mentor_id' },
  { tableName: 'reviews', whereColumn: 'reviewer_id' },
  { tableName: 'payments', whereColumn: 'user_id' },
  { tableName: 'notifications', whereColumn: 'user_id' },
  { tableName: 'user_preferences', whereColumn: 'user_id' },
  { tableName: 'escrow_transactions', whereColumn: 'buyer_id' },
  { tableName: 'escrow_transactions', whereColumn: 'seller_id' },
  { tableName: 'disputes', whereColumn: 'initiator_id' },
  { tableName: 'meeting_participants', whereColumn: 'user_id' },
  { tableName: 'audit_logs', whereColumn: 'user_id' },
];

function isValidDeletionTarget(
  tableName: string,
  whereColumn: string
): boolean {
  return DELETION_WHITELIST.some(
    (entry) => entry.tableName === tableName && entry.whereColumn === whereColumn
  );
}

async function deleteFromTableIfPresent(
  client: PoolClient,
  tableName: string,
  whereColumn: string,
  userId: string
): Promise<void> {
  if (!isValidDeletionTarget(tableName, whereColumn)) {
    throw new Error(
      `Invalid deletion target: table "${tableName}" with column "${whereColumn}" is not in the whitelist`
    );
  }

  await client.query(
    `DELETE FROM "${tableName}" WHERE "${whereColumn}" = $1`,
    [userId]
  );
}

async function deleteUserAccount(userId: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await deleteFromTableIfPresent(client, 'audit_logs', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'meeting_participants', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'disputes', 'initiator_id', userId);
    await deleteFromTableIfPresent(client, 'escrow_transactions', 'buyer_id', userId);
    await deleteFromTableIfPresent(client, 'escrow_transactions', 'seller_id', userId);
    await deleteFromTableIfPresent(client, 'reviews', 'reviewer_id', userId);
    await deleteFromTableIfPresent(client, 'bookings', 'mentee_id', userId);
    await deleteFromTableIfPresent(client, 'bookings', 'mentor_id', userId);
    await deleteFromTableIfPresent(client, 'notifications', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'payments', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'refresh_tokens', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'sessions', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'user_preferences', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'profiles', 'user_id', userId);
    await deleteFromTableIfPresent(client, 'users', 'id', userId);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { deleteUserAccount, deleteFromTableIfPresent, DELETION_WHITELIST };
