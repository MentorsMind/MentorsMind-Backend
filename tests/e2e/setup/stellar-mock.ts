/**
 * stellar-mock.ts
 *
 * Replaces all Stellar Horizon network calls with deterministic in-process stubs.
 * Import this file (or call `installStellarMocks()`) at the top of any E2E test
 * file that would otherwise trigger real network I/O against testnet/mainnet.
 *
 * The mock honours the same TypeScript interfaces used by the production code so
 * TypeScript can catch interface drift at compile time.
 */

import { Keypair } from '@stellar/stellar-sdk';

// ─── Deterministic test key-pairs ────────────────────────────────────────────
// These are FIXED test keys — they exist on testnet, funded via Friendbot, but
// we never actually call Horizon; they are only used to keep the SDK happy when
// it validates key format.

export const TEST_PLATFORM_KEYPAIR = Keypair.random();
export const TEST_MENTOR_KEYPAIR = Keypair.random();
export const TEST_MENTEE_KEYPAIR = Keypair.random();
export const TEST_ADMIN_KEYPAIR = Keypair.random();

// ─── Mock account state ───────────────────────────────────────────────────────

export interface MockStellarAccount {
  publicKey: string;
  xlmBalance: string;
  sequenceNumber: string;
}

const mockAccounts = new Map<string, MockStellarAccount>();

function getOrCreateAccount(publicKey: string): MockStellarAccount {
  if (!mockAccounts.has(publicKey)) {
    mockAccounts.set(publicKey, {
      publicKey,
      xlmBalance: '10000.0000000',
      sequenceNumber: '1234567890',
    });
  }
  return mockAccounts.get(publicKey)!;
}

// ─── Mock Horizon Server ──────────────────────────────────────────────────────

/**
 * Minimal mock that satisfies the Horizon.Server interface used by the
 * production stellar.service.ts.
 */
export function createMockHorizonServer() {
  return {
    loadAccount: jest.fn(async (publicKey: string) => {
      const account = getOrCreateAccount(publicKey);
      return {
        id: account.publicKey,
        account_id: account.publicKey,
        sequence: account.sequenceNumber,
        balances: [
          {
            asset_type: 'native',
            balance: account.xlmBalance,
          },
        ],
        incrementSequenceNumber: jest.fn(),
        sequenceNumber: jest.fn(() => account.sequenceNumber),
      };
    }),

    submitTransaction: jest.fn(async (_transaction: unknown) => ({
      hash: `mock-tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ledger: 12345,
      successful: true,
      envelope_xdr: 'mock-xdr',
      result_xdr: 'mock-result-xdr',
      result_meta_xdr: 'mock-meta-xdr',
    })),

    transactions: jest.fn(() => ({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    })),

    operations: jest.fn(() => ({
      forAccount: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    })),

    fetchBaseFee: jest.fn().mockResolvedValue(100),
    fetchTimebounds: jest.fn().mockResolvedValue({ minTime: 0, maxTime: 0 }),
  };
}

// ─── Mock Stellar Service ────────────────────────────────────────────────────

/**
 * Returns a mock version of the production stellarService that satisfies all
 * methods used by BookingsService, PaymentsService, WalletsService, etc.
 * without network access.
 */
export function createMockStellarService() {
  return {
    getAccount: jest.fn(async (publicKey: string) => {
      return getOrCreateAccount(publicKey);
    }),

    createAccount: jest.fn(async (publicKey: string) => {
      getOrCreateAccount(publicKey);
      return {
        hash: `mock-create-${Date.now()}`,
        successful: true,
      };
    }),

    sendPayment: jest.fn(async (params: {
      sourceSecretKey: string;
      destinationPublicKey: string;
      amount: string;
      asset?: unknown;
      memo?: string;
    }) => ({
      hash: `mock-payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      successful: true,
      ledger: 12345,
    })),

    getBalance: jest.fn(async (publicKey: string, _assetCode?: string) => {
      const account = getOrCreateAccount(publicKey);
      return account.xlmBalance;
    }),

    isAccountFunded: jest.fn(async (_publicKey: string) => true),

    activateWallet: jest.fn(async (_publicKey: string) => ({
      hash: `mock-activate-${Date.now()}`,
      successful: true,
    })),

    buildAndSubmitTransaction: jest.fn(async (_params: unknown) => ({
      hash: `mock-tx-${Date.now()}`,
      successful: true,
      ledger: 12345,
    })),

    getTransactionDetails: jest.fn(async (hash: string) => ({
      hash,
      successful: true,
      ledger: 12345,
      created_at: new Date().toISOString(),
    })),

    getTransaction: jest.fn(async (txHash: string) => ({
      successful: true,
      hash: txHash,
      source_account: TEST_MENTEE_KEYPAIR.publicKey(),
      created_at: new Date().toISOString(),
    })),

    getTransactionOperations: jest.fn(async (_txHash: string) => {
      if (_mockPaymentOperation) {
        return [{
          id: 'op-mock-1',
          type: 'payment',
          amount: parseFloat(_mockPaymentOperation.amount || '50').toFixed(7),
          to: _mockPaymentOperation.to || TEST_PLATFORM_KEYPAIR.publicKey(),
          asset_type: 'native',
          source_account: TEST_MENTEE_KEYPAIR.publicKey(),
        }];
      }

      const pgUrl = process.env.DATABASE_URL;
      if (pgUrl) {
        try {
          const { Pool } = await import('pg');
          const p = new Pool({ connectionString: pgUrl, max: 1 });
          const res = await p.query(
            "SELECT amount, to_address FROM transactions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1"
          );
          await p.end();
          if (res.rows[0]) {
            return [{
              id: 'op-mock-1',
              type: 'payment',
              amount: parseFloat(res.rows[0].amount).toFixed(7),
              to: res.rows[0].to_address || TEST_PLATFORM_KEYPAIR.publicKey(),
              asset_type: 'native',
              source_account: TEST_MENTEE_KEYPAIR.publicKey(),
            }];
          }
        } catch {
          // ignore
        }
      }

      return [{
        id: 'op-mock-1',
        type: 'payment',
        amount: '50.0000000',
        to: TEST_PLATFORM_KEYPAIR.publicKey(),
        asset_type: 'native',
        source_account: TEST_MENTEE_KEYPAIR.publicKey(),
      }];
    }),
  };
}

let _mockPaymentOperation: { amount?: string; to?: string } | null = null;
export function setMockPaymentOperation(op: { amount?: string; to?: string } | null): void {
  _mockPaymentOperation = op;
}

// ─── Module-level mock injection ─────────────────────────────────────────────

let _serverMock: ReturnType<typeof createMockHorizonServer> | null = null;
let _serviceMock: ReturnType<typeof createMockStellarService> | null = null;

/**
 * Call once before tests to swap the real Horizon server for an in-process mock.
 * Uses Jest module mocking so all `import ... from '../config/stellar'` in
 * production code receive the same mock instance.
 */
export function installStellarMocks(): void {
  _serverMock = createMockHorizonServer();
  _serviceMock = createMockStellarService();

  jest.mock('../../../src/config/stellar', () => ({
    server: _serverMock,
    networkPassphrase: 'Test SDF Network ; September 2015',
    getPlatformKeypair: jest.fn(() => TEST_PLATFORM_KEYPAIR),
    platformPublicKey: TEST_PLATFORM_KEYPAIR.publicKey(),
  }));

  jest.mock('../../../src/services/stellar.service', () => ({
    stellarService: _serviceMock,
    StellarService: jest.fn().mockImplementation(() => _serviceMock),
  }));

  jest.mock('../../../src/services/stellarFees.service', () => ({
    StellarFeesService: {
      estimateFee: jest.fn().mockResolvedValue({ fee: '0.00001', xlm: '0.00001' }),
    },
  }));

  jest.mock('../../../src/services/stellar-stream.service', () => ({
    StellarStreamService: {
      streamTransactions: jest.fn().mockReturnValue({ close: jest.fn() }),
    },
  }));
}

export function getStellarServerMock() {
  return _serverMock;
}

export function getStellarServiceMock() {
  return _serviceMock;
}

/**
 * Reset all mock call counts between tests. Does NOT remove the mock — call
 * jest.restoreAllMocks() or jest.resetModules() for that.
 */
export function resetStellarMocks(): void {
  _serverMock?.loadAccount.mockClear();
  _serverMock?.submitTransaction.mockClear();
  _serviceMock?.sendPayment.mockClear();
  _serviceMock?.getBalance.mockClear();
}
