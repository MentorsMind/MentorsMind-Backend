/**
 * Stellar SDK Mock Factory
 * Provides mock implementations for Stellar SDK operations
 */

export interface MockStellarAccount {
    accountId: string;
    sequence: string;
    balances: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        balance: string;
    }>;
}

export interface MockStellarTransaction {
    hash: string;
    ledger: number;
    created_at: string;
    source_account: string;
    fee_charged: string;
    operation_count: number;
    memo?: string;
}

export interface MockStellarOperation {
    id: string;
    type: string;
    type_i: number;
    created_at: string;
    transaction_hash: string;
    source_account: string;
    amount?: string;
    asset_type?: string;
    asset_code?: string;
    asset_issuer?: string;
    from?: string;
    to?: string;
}

/**
 * Create a mock Stellar account
 */
export function createMockStellarAccount(
    overrides: Partial<MockStellarAccount> = {}
): MockStellarAccount {
    return {
        accountId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        sequence: '123456789',
        balances: [
            {
                asset_type: 'native',
                balance: '1000.0000000',
            },
        ],
        ...overrides,
    };
}

/**
 * Create a mock Stellar transaction
 */
export function createMockStellarTransaction(
    overrides: Partial<MockStellarTransaction> = {}
): MockStellarTransaction {
    return {
        hash: 'mock_transaction_hash_' + Math.random().toString(36).substring(7),
        ledger: 12345,
        created_at: new Date().toISOString(),
        source_account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        fee_charged: '100',
        operation_count: 1,
        ...overrides,
    };
}

/**
 * Create a mock Stellar operation
 */
export function createMockStellarOperation(
    overrides: Partial<MockStellarOperation> = {}
): MockStellarOperation {
    return {
        id: 'mock_operation_' + Math.random().toString(36).substring(7),
        type: 'payment',
        type_i: 1,
        created_at: new Date().toISOString(),
        transaction_hash: 'mock_transaction_hash',
        source_account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        amount: '100.0000000',
        asset_type: 'native',
        ...overrides,
    };
}

/**
 * Mock Stellar Server
 */
export function createMockStellarServer() {
    return {
        loadAccount: jest.fn(),
        transactions: jest.fn(),
        operations: jest.fn(),
        payments: jest.fn(),
        submitTransaction: jest.fn(),
        fetchBaseFee: jest.fn(),
        ledgers: jest.fn(),
        assets: jest.fn(),
        effects: jest.fn(),
        offers: jest.fn(),
        orderbook: jest.fn(),
        paths: jest.fn(),
        tradeAggregations: jest.fn(),
        trades: jest.fn(),
    };
}

/**
 * Mock Stellar SDK module
 */
export function mockStellarModule() {
    const mockServer = createMockStellarServer();

    jest.mock('@stellar/stellar-sdk', () => ({
        Server: jest.fn().mockImplementation(() => mockServer),
        Keypair: {
            random: jest.fn().mockReturnValue({
                publicKey: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                secretKey: () => 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
            }),
            fromSecret: jest.fn().mockReturnValue({
                publicKey: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
                secretKey: () => 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
            }),
        },
        TransactionBuilder: jest.fn().mockImplementation(() => ({
            addOperation: jest.fn().mockReturnThis(),
            addMemo: jest.fn().mockReturnThis(),
            setTimeout: jest.fn().mockReturnThis(),
            build: jest.fn().mockReturnValue({
                sign: jest.fn(),
                toXDR: jest.fn().mockReturnValue('mock_xdr'),
            }),
        })),
        Operation: {
            payment: jest.fn().mockReturnValue({ type: 'payment' }),
            createAccount: jest.fn().mockReturnValue({ type: 'createAccount' }),
            changeTrust: jest.fn().mockReturnValue({ type: 'changeTrust' }),
            manageSellOffer: jest.fn().mockReturnValue({ type: 'manageSellOffer' }),
            manageBuyOffer: jest.fn().mockReturnValue({ type: 'manageBuyOffer' }),
            pathPaymentStrictSend: jest.fn().mockReturnValue({ type: 'pathPaymentStrictSend' }),
            pathPaymentStrictReceive: jest.fn().mockReturnValue({ type: 'pathPaymentStrictReceive' }),
        },
        Asset: {
            native: jest.fn().mockReturnValue({ type: 'native' }),
            new: jest.fn().mockImplementation((code, issuer) => ({
                code,
                issuer,
                type: 'credit_alphanum4',
            })),
        },
        Memo: {
            text: jest.fn().mockReturnValue({ type: 'text', value: '' }),
            id: jest.fn().mockReturnValue({ type: 'id', value: '' }),
            hash: jest.fn().mockReturnValue({ type: 'hash', value: '' }),
            return: jest.fn().mockReturnValue({ type: 'return', value: '' }),
        },
        Networks: {
            PUBLIC: 'Public Global Stellar Network ; September 2015',
            TESTNET: 'Test SDF Network ; September 2015',
        },
        BASE_FEE: '100',
        TimeoutInfinite: 0,
    }));

    return mockServer;
}

/**
 * Setup common Stellar mock responses
 */
export function setupStellarMocks(mockServer: ReturnType<typeof createMockStellarServer>) {
    // Mock loadAccount
    mockServer.loadAccount.mockResolvedValue(createMockStellarAccount());

    // Mock transactions
    mockServer.transactions.mockReturnValue({
        call: jest.fn().mockResolvedValue({
            records: [createMockStellarTransaction()],
        }),
    });

    // Mock operations
    mockServer.operations.mockReturnValue({
        call: jest.fn().mockResolvedValue({
            records: [createMockStellarOperation()],
        }),
    });

    // Mock payments
    mockServer.payments.mockReturnValue({
        call: jest.fn().mockResolvedValue({
            records: [createMockStellarOperation()],
        }),
    });

    // Mock submitTransaction
    mockServer.submitTransaction.mockResolvedValue({
        hash: 'mock_submitted_transaction_hash',
        ledger: 12346,
        envelope_xdr: 'mock_envelope_xdr',
        result_xdr: 'mock_result_xdr',
    });

    // Mock fetchBaseFee
    mockServer.fetchBaseFee.mockResolvedValue(100);

    return mockServer;
}
