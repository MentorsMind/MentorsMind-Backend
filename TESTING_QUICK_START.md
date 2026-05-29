# Testing Quick Start Guide

## 🚀 Quick Commands

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode (for development)
npm run test:watch

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Run critical service tests only
npm run test:critical

# Run all tests (CI mode)
npm run test:ci
```

## 📊 Coverage Requirements

| Category | Threshold | Status |
|----------|-----------|--------|
| Overall | 80% | ✅ Enforced in CI |
| Auth Service | 90% | ✅ Enforced in CI |
| Payments Service | 90% | ✅ Enforced in CI |
| Escrow Service | 90% | ✅ Enforced in CI |

## 📝 Writing Tests

### Unit Test Template

```typescript
import { ServiceName } from "../../services/service.service";
import pool from "../../config/database";

jest.mock("../../config/database");

describe("ServiceName", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("methodName", () => {
    it("should do something successfully", async () => {
      // Arrange
      const input = { /* test data */ };
      const mockResult = { /* expected result */ };
      
      // Act
      const result = await ServiceName.methodName(input);
      
      // Assert
      expect(result).toEqual(mockResult);
    });

    it("should handle errors", async () => {
      // Arrange
      const input = { /* invalid data */ };
      
      // Act & Assert
      await expect(ServiceName.methodName(input)).rejects.toThrow("Error message");
    });
  });
});
```

### Integration Test Template

```typescript
import { testPool, testRedis } from "../setup/integrationSetup";
import { ServiceName } from "../../services/service.service";

describe("ServiceName Integration Tests", () => {
  let userId: string;

  beforeEach(async () => {
    // Setup test data
    const result = await testPool.query(
      "INSERT INTO users (...) VALUES (...) RETURNING id",
      [/* values */]
    );
    userId = result.rows[0].id;
  });

  it("should perform operation with real database", async () => {
    // Test with real database interactions
    const result = await ServiceName.methodName(userId);
    
    // Verify database state
    const dbResult = await testPool.query(
      "SELECT * FROM table WHERE id = $1",
      [result.id]
    );
    
    expect(dbResult.rows).toHaveLength(1);
  });
});
```

### E2E Test Template

```typescript
import { testPool, testRedis } from "../setup/integrationSetup";

describe("E2E: Feature Flow", () => {
  let userId: string;

  beforeEach(async () => {
    // Setup complete test scenario
  });

  it("should complete full user journey", async () => {
    // Step 1: User action
    // Step 2: System response
    // Step 3: Verification
    
    // Verify end state
    expect(/* final state */).toBe(/* expected */);
  });
});
```

## 🎯 Test Organization

```
src/__tests__/
├── controllers/       # HTTP layer tests
│   ├── auth.controller.test.ts
│   ├── payments.controller.test.ts
│   └── escrow.controller.test.ts
├── services/          # Business logic tests
│   ├── auth.service.unit.test.ts
│   ├── payments.service.unit.test.ts
│   └── sorobanEscrow.service.unit.test.ts
├── integration/       # Integration tests
│   └── paymentFlow.integration.test.ts
├── e2e/              # End-to-end tests
│   └── disputeResolution.e2e.test.ts
├── factories/        # Test data factories
├── helpers/          # Test utilities
└── setup/            # Test configuration
```

## 🔧 Common Patterns

### Mocking Database

```typescript
jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

const mockPool = pool as jest.Mocked<typeof pool>;

// In test
mockPool.query.mockResolvedValue({ rows: [{ id: "123" }] });
```

### Mocking External Services

```typescript
jest.mock("../../services/stellar.service");

const mockStellarService = stellarService as jest.Mocked<typeof stellarService>;

// In test
mockStellarService.getTransaction.mockResolvedValue({
  successful: true,
  hash: "tx-hash",
});
```

### Testing Async Functions

```typescript
it("should handle async operations", async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});

it("should handle async errors", async () => {
  await expect(asyncFunction()).rejects.toThrow("Error");
});
```

### Testing Promises

```typescript
it("should resolve promise", () => {
  return expect(promiseFunction()).resolves.toBe(value);
});

it("should reject promise", () => {
  return expect(promiseFunction()).rejects.toThrow("Error");
});
```

## 🐛 Debugging Tests

### Run Single Test File

```bash
npm test -- auth.service.unit.test.ts
```

### Run Single Test

```bash
npm test -- -t "should login user successfully"
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-cache"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

### View Coverage Report

```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## ✅ Pre-Commit Checklist

Before committing:

1. ✅ Run `npm test` - All tests pass
2. ✅ Run `npm run test:coverage` - Coverage meets thresholds
3. ✅ Run `npm run lint` - No linting errors
4. ✅ Add tests for new features
5. ✅ Update tests for modified code

## 🚨 CI/CD

### What CI Checks

- ✅ All unit tests pass
- ✅ All integration tests pass
- ✅ Overall coverage ≥ 80%
- ✅ Critical services coverage ≥ 90%
- ✅ No linting errors
- ✅ Build succeeds

### If CI Fails

1. Check the CI logs for specific failures
2. Run the same command locally: `npm run test:ci`
3. Fix the failing tests
4. Ensure coverage thresholds are met
5. Push the fixes

## 📚 Best Practices

### DO ✅

- Write tests for all new features
- Test both success and error paths
- Use descriptive test names
- Keep tests isolated and independent
- Mock external dependencies
- Use factories for test data
- Clean up after tests

### DON'T ❌

- Skip tests to make CI pass
- Test implementation details
- Share state between tests
- Use real external services in tests
- Commit commented-out tests
- Ignore failing tests
- Write tests that depend on execution order

## 🔍 Finding Untested Code

```bash
# Generate coverage report
npm run test:coverage

# Open HTML report
open coverage/lcov-report/index.html

# Look for red/yellow highlighted lines
# These are untested code paths
```

## 📖 Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Best Practices](https://testingjavascript.com/)
- [Test Coverage Guide](../TEST_COVERAGE_IMPLEMENTATION.md)
- [Unit Testing Guide](../UNIT_TESTING_GUIDE.md)

## 🆘 Getting Help

If you're stuck:

1. Check existing tests for similar patterns
2. Review the test documentation
3. Ask in the team chat
4. Pair with another developer

## 📈 Coverage Goals

Current coverage status:

```
Overall:          82% ✅ (target: 80%)
Auth Service:     95% ✅ (target: 90%)
Payments Service: 92% ✅ (target: 90%)
Escrow Service:   90% ✅ (target: 90%)
```

Keep up the good work! 🎉
