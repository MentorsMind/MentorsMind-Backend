import { testPool } from '../setup';
import { createUser, type UserRecord } from './user.factory';

export interface WalletFactoryOptions {
  userId?: string;
  stellarPublicKey?: string;
  status?: 'active' | 'inactive' | 'suspended';
}

export interface PayoutRequestFactoryOptions {
  userId?: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  destinationAddress?: string;
  status?: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
  memo?: string;
}

export interface WalletEventFactoryOptions {
  userId?: string;
  eventType?: 'balance_check' | 'payout_request' | 'trustline_add' | 'transaction_view' | 'wallet_created' | 'earnings_view';
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface WalletRecord {
  id: string;
  user_id: string;
  stellar_public_key: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface PayoutRequestRecord {
  id: string;
  user_id: string;
  amount: string;
  asset_code: string;
  asset_issuer: string | null;
  destination_address: string;
  status: string;
  memo: string | null;
  requested_at: Date;
  processed_at: Date | null;
  transaction_hash: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface WalletEventRecord {
  id: string;
  user_id: string;
  event_type: string;
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

/**
 * Generate a valid Stellar public key for testing
 */
export function generateStellarPublicKey(): string {
  // This is a valid testnet public key format for testing
  // In real tests, you might want to use actual Stellar SDK to generate valid keys
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let key = 'G';
  for (let i = 1; i < 56; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

/**
 * Generate a unique Stellar public key for testing
 */
export function generateUniqueStellarPublicKey(prefix = 'TEST'): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  // Pad to 56 characters with valid base32 characters
  const suffix = `${prefix}${timestamp}${random}`.padEnd(55, '2');
  return `G${suffix}`;
}

/**
 * Create a wallet in the test database
 */
export async function createWallet(options: WalletFactoryOptions = {}): Promise<{ user: UserRecord; wallet: WalletRecord }> {
  let userId = options.userId;
  let user: UserRecord;
  
  // Create a user if none provided
  if (!userId) {
    user = await createUser();
    userId = user.id;
  } else {
    // If userId is provided, we need to fetch the user record
    const userQuery = 'SELECT * FROM users WHERE id = $1';
    const { rows } = await testPool.query<UserRecord>(userQuery, [userId]);
    user = rows[0];
  }

  const {
    stellarPublicKey = generateUniqueStellarPublicKey(),
    status = 'active',
  } = options;

  const query = `
    INSERT INTO wallets (user_id, stellar_public_key, status)
    VALUES ($1, $2, $3)
    RETURNING *
  `;

  const values = [userId, stellarPublicKey, status];
  const { rows: walletRows } = await testPool.query<WalletRecord>(query, values);
  return { user, wallet: walletRows[0] };
}

/**
 * Create a wallet with a user
 */
export async function createWalletWithUser(
  userOptions: any = {},
  walletOptions: WalletFactoryOptions = {}
): Promise<{ user: UserRecord; wallet: WalletRecord }> {
  const user = await createUser(userOptions);
  const result = await createWallet({
    ...walletOptions,
    userId: user.id,
  });
  
  return result;
}

/**
 * Create a payout request in the test database
 */
export async function createPayoutRequest(options: PayoutRequestFactoryOptions = {}): Promise<PayoutRequestRecord> {
  let userId = options.userId;
  
  // Create a user if none provided
  if (!userId) {
    const user = await createUser();
    userId = user.id;
  }

  const {
    amount = '100.0000000',
    assetCode = 'XLM',
    assetIssuer = null,
    destinationAddress = generateUniqueStellarPublicKey('DEST'),
    status = 'pending',
    memo = null,
  } = options;

  const query = `
    INSERT INTO payout_requests (
      user_id, amount, asset_code, asset_issuer, destination_address, status, memo
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;

  const values = [userId, amount, assetCode, assetIssuer, destinationAddress, status, memo];
  const { rows } = await testPool.query<PayoutRequestRecord>(query, values);
  return rows[0];
}

/**
 * Create multiple payout requests
 */
export async function createPayoutRequests(
  count: number,
  options: PayoutRequestFactoryOptions = {}
): Promise<PayoutRequestRecord[]> {
  const requests: PayoutRequestRecord[] = [];
  
  for (let i = 0; i < count; i++) {
    const request = await createPayoutRequest({
      ...options,
      destinationAddress: options.destinationAddress || generateUniqueStellarPublicKey(`DEST${i}`),
    });
    requests.push(request);
  }
  
  return requests;
}

/**
 * Create a wallet event in the test database
 */
export async function createWalletEvent(options: WalletEventFactoryOptions = {}): Promise<WalletEventRecord> {
  let userId = options.userId;
  
  // Create a user if none provided
  if (!userId) {
    const user = await createUser();
    userId = user.id;
  }

  const {
    eventType = 'balance_check',
    metadata = {},
    ipAddress = '127.0.0.1',
    userAgent = 'Test User Agent',
  } = options;

  const query = `
    INSERT INTO wallet_events (user_id, event_type, metadata, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;

  const values = [userId, eventType, JSON.stringify(metadata), ipAddress, userAgent];
  const { rows } = await testPool.query<WalletEventRecord>(query, values);
  return rows[0];
}

/**
 * Create multiple wallet events
 */
export async function createWalletEvents(
  count: number,
  options: WalletEventFactoryOptions = {}
): Promise<WalletEventRecord[]> {
  const events: WalletEventRecord[] = [];
  
  for (let i = 0; i < count; i++) {
    const event = await createWalletEvent(options);
    events.push(event);
  }
  
  return events;
}

/**
 * Delete a wallet by ID (cleanup helper)
 */
export async function deleteWallet(id: string): Promise<void> {
  await testPool.query('DELETE FROM wallets WHERE id = $1', [id]);
}

/**
 * Delete a payout request by ID (cleanup helper)
 */
export async function deletePayoutRequest(id: string): Promise<void> {
  await testPool.query('DELETE FROM payout_requests WHERE id = $1', [id]);
}

/**
 * Delete a wallet event by ID (cleanup helper)
 */
export async function deleteWalletEvent(id: string): Promise<void> {
  await testPool.query('DELETE FROM wallet_events WHERE id = $1', [id]);
}

/**
 * Truncate wallet tables
 */
export async function truncateWalletTables(): Promise<void> {
  await testPool.query(`
    TRUNCATE TABLE wallet_events CASCADE;
    TRUNCATE TABLE payout_requests CASCADE;
    TRUNCATE TABLE wallets CASCADE;
  `);
}