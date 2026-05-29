/**
 * Wallet-specific TypeScript interfaces and types
 */

// ---------------------------------------------------------------------------
// Database Model Types
// ---------------------------------------------------------------------------

export interface WalletRecord {
  id: string;
  user_id: string;
  stellar_public_key: string;
  status: 'active' | 'inactive' | 'suspended';
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
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
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
  event_type: 'balance_check' | 'payout_request' | 'trustline_add' | 'transaction_view' | 'wallet_created' | 'earnings_view';
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// API Request/Response Types
// ---------------------------------------------------------------------------

export interface WalletInfoResponse {
  id: string;
  stellarPublicKey: string;
  status: string;
  createdAt: string;
  lastActivity?: string;
}

export interface BalanceResponse {
  balances: Array<{
    assetType: string;
    assetCode?: string;
    assetIssuer?: string;
    balance: string;
    limit?: string;
  }>;
  accountExists: boolean;
  message?: string;
  lastUpdated: string;
}

export interface TransactionHistoryResponse {
  transactions: Array<{
    id: string;
    hash: string;
    ledger: number;
    createdAt: string;
    sourceAccount: string;
    operationCount: number;
    successful: boolean;
    memo?: string;
    memoType?: string;
  }>;
  pagination: {
    cursor?: string;
    hasMore: boolean;
  };
}

export interface PayoutRequestInput {
  amount: string;
  assetCode?: string;
  assetIssuer?: string;
  destinationAddress: string;
  memo?: string;
}

export interface PayoutRequestResponse {
  id: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  destinationAddress: string;
  status: string;
  requestedAt: string;
  memo?: string;
}

export interface TrustlineRequestInput {
  assetCode: string;
  assetIssuer: string;
  limit?: string;
}

export interface TrustlineOperationResponse {
  message: string;
  operation: {
    type: string;
    assetCode: string;
    assetIssuer: string;
    limit: string;
  };
}

export interface EarningsSummaryResponse {
  totalEarnings: string;
  currentPeriodEarnings: string;
  recentTransactions: Array<{
    id: string;
    amount: string;
    assetCode: string;
    date: string;
    type: 'session_payment' | 'bonus' | 'referral';
  }>;
  periodSummary: {
    startDate: string;
    endDate: string;
    sessionCount: number;
    averageEarning: string;
  };
}

export interface PayoutRequestsResponse {
  payoutRequests: Array<{
    id: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    destinationAddress: string;
    status: string;
    memo?: string;
    requestedAt: string;
    processedAt?: string;
    transactionHash?: string;
    notes?: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

// ---------------------------------------------------------------------------
// Query Parameter Types
// ---------------------------------------------------------------------------

export interface TransactionQuery {
  cursor?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

export interface EarningsQuery {
  startDate?: string;
  endDate?: string;
  assetCode?: string;
  page?: number;
  limit?: number;
}

export interface BalanceQuery {
  assetCode?: string;
  assetIssuer?: string;
}

export interface PayoutQuery {
  page?: number;
  limit?: number;
  status?: string;
}

// ---------------------------------------------------------------------------
// Service Layer Types
// ---------------------------------------------------------------------------

export interface WalletServiceData {
  userId: string;
  stellarPublicKey?: string;
}

export interface PayoutRequestData {
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  destinationAddress: string;
  memo?: string;
}

export interface WalletEventData {
  eventType: WalletEventRecord['event_type'];
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface WalletStats {
  totalWallets: number;
  activeWallets: number;
  totalPayoutRequests: number;
  pendingPayouts: number;
}

// ---------------------------------------------------------------------------
// Stellar Integration Types
// ---------------------------------------------------------------------------

export interface StellarAsset {
  code: string;
  issuer?: string;
  type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
}

export interface TrustlineInfo {
  asset: StellarAsset;
  balance: string;
  limit: string;
  authorized: boolean;
}

export interface WalletBalance {
  asset: StellarAsset;
  balance: string;
  available: string;
  reserved: string;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export interface WalletError extends Error {
  code: 'WALLET_NOT_FOUND' | 'INVALID_STELLAR_ADDRESS' | 'INSUFFICIENT_BALANCE' | 
        'TRUSTLINE_EXISTS' | 'STELLAR_NETWORK_ERROR' | 'VALIDATION_ERROR';
  details?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Utility Types
// ---------------------------------------------------------------------------

export type WalletStatus = 'active' | 'inactive' | 'suspended';
export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
export type WalletEventType = 'balance_check' | 'payout_request' | 'trustline_add' | 'transaction_view' | 'wallet_created' | 'earnings_view';

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

export function isValidWalletStatus(status: string): status is WalletStatus {
  return ['active', 'inactive', 'suspended'].includes(status);
}

export function isValidPayoutStatus(status: string): status is PayoutStatus {
  return ['pending', 'approved', 'rejected', 'completed', 'failed'].includes(status);
}

export function isValidWalletEventType(eventType: string): eventType is WalletEventType {
  return ['balance_check', 'payout_request', 'trustline_add', 'transaction_view', 'wallet_created', 'earnings_view'].includes(eventType);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const WALLET_CONSTANTS = {
  MAX_STELLAR_AMOUNT: '922337203685.4775807',
  MIN_STELLAR_AMOUNT: '0.0000001',
  MAX_MEMO_LENGTH: 28,
  MAX_ASSET_CODE_LENGTH: 12,
  STELLAR_PUBLIC_KEY_LENGTH: 56,
  STELLAR_PUBLIC_KEY_PREFIX: 'G',
  DEFAULT_ASSET_CODE: 'XLM',
  DEFAULT_PAGINATION_LIMIT: 10,
  MAX_PAGINATION_LIMIT: 100,
} as const;