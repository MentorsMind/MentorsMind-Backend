# Unit Testing Infrastructure Guide

## Overview

This guide documents the unit testing infrastructure for MentorsMind Backend. Unit tests are designed to test individual services and utilities in isolation by mocking all external dependencies.

## Table of Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Mock Factories](#mock-factories)
- [Writing Unit Tests](#writing-unit-tests)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Quick Start

### Running Unit Tests

```bash
# Run all unit tests
npm test

# Run unit tests with coverage
npm run test:coverage

# Run unit tests in watch mode
npm run test:watch

# Run a specific test file
npm test -- path/to/test.unit.test.ts

# Run tests matching a pattern
npm test -- --testNamePattern="should send email"
```

### Test File Naming Convention

Unit test files should follow this naming pattern:
- `*.unit.test.ts` - For unit tests
- Located in `__tests__/` directories or co-located with source files

## Configuration

### Jest Configuration (`jest.unit.config.ts`)

The unit test configuration includes:

- **TypeScript Support**: Uses `ts-jest` for TypeScript compilation
- **Path Aliases**: Configured to match `tsconfig.json` (`@/` maps to `src/`)
- **Setup File**: `src/tests/jest.setup.ts` for global test utilities
- **Coverage**: Configured with 80% threshold for lines, statements, and functions
- **Mocking**: Automatic mock clearing and restoration between tests

### Path Aliases

```typescript
moduleNameMapper: {
  "^@/(.*)$": "<rootDir>/src/$1",  // Maps @/ to src/
  "^uuid$": "<rootDir>/src/tests/mocks/uuid.ts",  // Mock UUID for consistent testing
}
```

## Mock Factories

### Database Mock (`src/tests/mocks/database.mock.ts`)

Provides mock implementations for PostgreSQL operations:

```typescript
import { createMockPool, createMockQueryResult, mockDatabaseModule } from '../tests/mocks';

// Create a mock pool
const mockPool = createMockPool();

// Create mock query results
const result = createMockQueryResult([{ id: '1', name: 'Test' }]);

// Mock the entire database module
mockDatabaseModule();
```

**Available Functions:**
- `createMockPool()` - Creates a mock database pool
- `createMockQueryResult(rows)` - Creates a mock query result
- `createMockInsertResult(row)` - Creates a mock INSERT result
- `createMockUpdateResult(rows)` - Creates a mock UPDATE result
- `createMockDeleteResult(count)` - Creates a mock DELETE result
- `mockDatabaseModule()` - Mocks the database module
- `setupDatabaseMocks(pool)` - Sets up common mock responses

### Redis Mock (`src/tests/mocks/redis.mock.ts`)

Provides mock implementations for Redis operations:

```typescript
import { createMockRedisClient, mockRedisModule, setupRedisMocks } from '../tests/mocks';

// Create a mock Redis client
const mockClient = createMockRedisClient();

// Mock the Redis module
mockRedisModule();

// Setup common responses
setupRedisMocks(mockClient);
```

**Available Functions:**
- `createMockRedisClient()` - Creates a mock Redis client
- `mockRedisModule()` - Mocks the ioredis module
- `setupRedisMocks(client)` - Sets up common mock responses
- `createMockCacheService()` - Creates a mock cache service

### Stellar SDK Mock (`src/tests/mocks/stellar.mock.ts`)

Provides mock implementations for Stellar SDK operations:

```typescript
import { 
  createMockStellarServer, 
  mockStellarModule, 
  setupStellarMocks,
  createMockStellarAccount,
  createMockStellarTransaction 
} from '../tests/mocks';

// Create a mock Stellar server
const mockServer = createMockStellarServer();

// Mock the Stellar SDK module
mockStellarModule();

// Setup common responses
setupStellarMocks(mockServer);

// Create mock data
const account = createMockStellarAccount({ balance: '1000.0000000' });
const transaction = createMockStellarTransaction({ hash: 'mock_hash' });
```

**Available Functions:**
- `createMockStellarServer()` - Creates a mock Stellar server
- `mockStellarModule()` - Mocks the @stellar/stellar-sdk module
- `setupStellarMocks(server)` - Sets up common mock responses
- `createMockStellarAccount(overrides)` - Creates a mock Stellar account
- `createMockStellarTransaction(overrides)` - Creates a mock transaction
- `createMockStellarOperation(overrides)` - Creates a mock operation

### Email Service Mock (`src/tests/mocks/email.mock.ts`)

Provides mock implementations for email service operations:

```typescript
import { 
  createMockEmailService, 
  mockEmailServiceModule, 
  setupEmailServiceMocks,
  createMockEmailResult 
} from '../tests/mocks';

// Create a mock email service
const mockService = createMockEmailService();

// Mock the email service module
mockEmailServiceModule();

// Setup common responses
setupEmailServiceMocks(mockService);

// Create mock email result
const result = createMockEmailResult({ messageId: 'custom_id' });
```

**Available Functions:**
- `createMockEmailService()` - Creates a mock email service
- `mockEmailServiceModule()` - Mocks the email.service module
- `setupEmailServiceMocks(service)` - Sets up common mock responses
- `createMockEmailResult(overrides)` - Creates a mock email result
- `mockNodemailerModule()` - Mocks the nodemailer module
- `setupNodemailerMocks(transporter)` - Sets up nodemailer mock responses

## Writing Unit Tests

### Basic Test Structure

```typescript
import { mockDatabaseModule, setupDatabaseMocks } from '../../tests/mocks';
import { someService } from '../../services/some.service';

// Mock dependencies
const mockPool = mockDatabaseModule();
setupDatabaseMocks(mockPool);

describe('SomeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should perform some action', async () => {
    // Arrange
    mockPool.query.mockResolvedValue({
      rows: [{ id: '1', name: 'Test' }],
      rowCount: 1,
    });

    // Act
    const result = await someService.getAction('1');

    // Assert
    expect(result).toEqual({ id: '1', name: 'Test' });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      ['1']
    );
  });
});
```

### Testing with Multiple Mocks

```typescript
import { 
  mockDatabaseModule, 
  mockRedisModule, 
  mockEmailServiceModule,
  setupDatabaseMocks,
  setupRedisMocks,
  setupEmailServiceMocks 
} from '../../tests/mocks';

// Mock all dependencies
const mockPool = mockDatabaseModule();
const mockRedis = mockRedisModule();
const mockEmail = mockEmailServiceModule();

// Setup common responses
setupDatabaseMocks(mockPool);
setupRedisMocks(mockRedis);
setupEmailServiceMocks(mockEmail);

describe('ComplexService', () => {
  it('should handle complex workflow', async () => {
    // Arrange
    mockRedis.get.mockResolvedValue(null);
    mockPool.query.mockResolvedValue({
      rows: [{ id: '1' }],
      rowCount: 1,
    });
    mockEmail.sendEmail.mockResolvedValue({
      messageId: 'msg_123',
      accepted: ['user@example.com'],
    });

    // Act
    const result = await complexService.process();

    // Assert
    expect(mockRedis.get).toHaveBeenCalled();
    expect(mockPool.query).toHaveBeenCalled();
    expect(mockEmail.sendEmail).toHaveBeenCalled();
  });
});
```

### Using Global Test Utilities

The setup file provides global test utilities:

```typescript
describe('Using global utilities', () => {
  it('should use random generators', () => {
    const email = testUtils.randomEmail('user');
    const uuid = testUtils.randomUUID();
    const randomStr = testUtils.randomString(10);

    expect(email).toMatch(/user\.\d+\.[a-z0-9]+@test\.com/);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(randomStr).toHaveLength(10);
  });

  it('should handle dates', () => {
    const future = testUtils.futureDate(7);
    const past = testUtils.pastDate(3);

    expect(future.getTime()).toBeGreaterThan(Date.now());
    expect(past.getTime()).toBeLessThan(Date.now());
  });
});
```

## Best Practices

### 1. Test Isolation

- Each test should be independent and not rely on other tests
- Use `beforeEach` to reset mocks and state
- Avoid shared mutable state between tests

### 2. Mock Only What's Necessary

- Mock external dependencies (database, Redis, external APIs)
- Don't mock the code you're testing
- Keep mocks simple and focused

### 3. Clear Test Structure

Follow the Arrange-Act-Assert pattern:
- **Arrange**: Set up test data and mocks
- **Act**: Execute the code being tested
- **Assert**: Verify the results

### 4. Descriptive Test Names

```typescript
// Good
it('should send welcome email when user registers', async () => {
  // ...
});

// Bad
it('test email', async () => {
  // ...
});
```

### 5. Test Edge Cases

- Test error conditions
- Test boundary values
- Test null/undefined inputs
- Test async operations

### 6. Coverage Goals

- Aim for 80%+ code coverage
- Focus on critical business logic
- Don't chase 100% coverage at the expense of test quality

## Troubleshooting

### TypeScript Errors in Mock Files

TypeScript errors like "Cannot find name 'jest'" are expected in mock files. These files are processed by ts-jest at runtime and will work correctly.

### Mocks Not Working

1. Ensure mocks are set up before importing the module being tested
2. Use `jest.clearAllMocks()` in `beforeEach` to reset state
3. Check that mock functions are called with correct arguments

### Tests Timing Out

1. Increase `testTimeout` in jest.unit.config.ts
2. Check for unresolved promises
3. Ensure async operations are properly awaited

### Coverage Not Collecting

1. Verify `collectCoverageFrom` patterns in config
2. Ensure source files are in the `src/` directory
3. Check that files aren't excluded by ignore patterns

### Path Alias Not Working

1. Verify `moduleNameMapper` in jest.unit.config.ts
2. Ensure path matches tsconfig.json configuration
3. Check that the mapped path exists

## Example Test Files

See existing unit tests for examples:
- `src/__tests__/jobs/sessionReminder.job.unit.test.ts` - Job testing example
- `src/__tests__/controllers/wallets.controller.test.ts` - Controller testing example

## Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [ts-jest Documentation](https://kulshekhar.github.io/ts-jest/)
- [Jest Mock Functions](https://jestjs.io/docs/mock-functions)
- [Testing Best Practices](https://jestjs.io/docs/setup-teardown)

## Support

For questions or issues with the testing infrastructure, please refer to the project documentation or create an issue in the repository.
