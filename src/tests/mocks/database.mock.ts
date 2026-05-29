/**
 * Database Mock Factory
 * Provides mock implementations for database operations
 */

export interface MockQueryResult<T = any> {
    rows: T[];
    rowCount: number;
    command: string;
    oid: number;
    fields: any[];
}

export interface MockPool {
    query: jest.MockedFunction<any>;
    connect: jest.MockedFunction<any>;
    end: jest.MockedFunction<any>;
    on: jest.MockedFunction<any>;
}

/**
 * Create a mock database pool
 */
export function createMockPool(): MockPool {
    return {
        query: jest.fn(),
        connect: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
    };
}

/**
 * Create a mock query result
 */
export function createMockQueryResult<T = any>(
    rows: T[] = [],
    rowCount?: number
): MockQueryResult<T> {
    return {
        rows,
        rowCount: rowCount ?? rows.length,
        command: 'SELECT',
        oid: 0,
        fields: [],
    };
}

/**
 * Create a mock query result for INSERT operations
 */
export function createMockInsertResult<T = any>(
    insertedRow: T
): MockQueryResult<T> {
    return {
        rows: [insertedRow],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
    };
}

/**
 * Create a mock query result for UPDATE operations
 */
export function createMockUpdateResult<T = any>(
    updatedRows: T[] = [],
    rowCount = 0
): MockQueryResult<T> {
    return {
        rows: updatedRows,
        rowCount,
        command: 'UPDATE',
        oid: 0,
        fields: [],
    };
}

/**
 * Create a mock query result for DELETE operations
 */
export function createMockDeleteResult(rowCount = 0): MockQueryResult<never> {
    return {
        rows: [],
        rowCount,
        command: 'DELETE',
        oid: 0,
        fields: [],
    };
}

/**
 * Mock database module
 */
export function mockDatabaseModule() {
    const mockPool = createMockPool();

    jest.mock('../../config/database', () => ({
        query: (...args: any[]) => mockPool.query(...args),
        pool: mockPool,
    }));

    return mockPool;
}

/**
 * Setup common database mock responses
 */
export function setupDatabaseMocks(mockPool: MockPool) {
    // Default successful query response
    mockPool.query.mockResolvedValue(createMockQueryResult([]));

    // Mock connect
    mockPool.connect.mockResolvedValue({
        query: jest.fn(),
        release: jest.fn(),
    });

    // Mock end
    mockPool.end.mockResolvedValue(undefined);

    return mockPool;
}
