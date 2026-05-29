/**
 * Jest Setup for Unit Tests
 * 
 * This file provides global test utilities and mocks for unit tests.
 * Unlike integration tests, unit tests should not require a database connection.
 * All external dependencies are mocked here.
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Global test utilities
(global as any).testUtils = {
    /**
     * Generate a random string for testing
     */
    randomString: (length = 10): string => {
        return Math.random().toString(36).substring(2, 2 + length);
    },

    /**
     * Generate a random email for testing
     */
    randomEmail: (prefix = 'test'): string => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `${prefix}.${timestamp}.${random}@test.com`;
    },

    /**
     * Generate a random UUID for testing
     */
    randomUUID: (): string => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * Wait for a specified number of milliseconds
     */
    wait: (ms: number): Promise<void> => {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Create a mock date for testing
     */
    mockDate: (dateString: string): Date => {
        return new Date(dateString);
    },

    /**
     * Get a future date
     */
    futureDate: (daysFromNow = 1): Date => {
        const date = new Date();
        date.setDate(date.getDate() + daysFromNow);
        return date;
    },

    /**
     * Get a past date
     */
    pastDate: (daysAgo = 1): Date => {
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return date;
    },
};

// Global mocks setup
beforeAll(() => {
    // Suppress console.log/error/warn in tests unless DEBUG is set
    if (!process.env.DEBUG) {
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
        jest.spyOn(console, 'warn').mockImplementation(() => { });
    }
});

// Clear all mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
});

// Restore all mocks after each test
afterEach(() => {
    jest.restoreAllMocks();
});

// Global teardown
afterAll(() => {
    // Restore console methods
    if (!process.env.DEBUG) {
        jest.restoreAllMocks();
    }
});

// Type declarations for global test utilities
declare global {
    var testUtils: {
        randomString: (length?: number) => string;
        randomEmail: (prefix?: string) => string;
        randomUUID: () => string;
        wait: (ms: number) => Promise<void>;
        mockDate: (dateString: string) => Date;
        futureDate: (daysFromNow?: number) => Date;
        pastDate: (daysAgo?: number) => Date;
    };
}

export { };
