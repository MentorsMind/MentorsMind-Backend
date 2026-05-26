# Testing Guide

## Overview

This project maintains high test coverage with automated enforcement:
- **Overall Coverage**: 80% minimum
- **Critical Services**: 90% minimum (auth, payments, escrow)
- **CI/CD**: Automated coverage checks on every PR

## Quick Start

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Run in watch mode (development)
npm run test:watch

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

## Test Structure

```
src/__tests__/
├── controllers/       # HTTP layer tests
├── services/          # Business logic tests
├── integration/       # Integration tests
├── e2e/              # End-to-end tests
├── factories/        # Test data factories
├── helpers/          # Test utilities
└── setup/            # Test configuration
```

## Coverage Requirements

| Category | Threshold | Enforced |
|----------|-----------|----------|
| Overall | 80% | ✅ CI |
| Auth Service | 90% | ✅ CI |
| Payments Service | 90% | ✅ CI |
| Escrow Service | 90% | ✅ CI |

## Writing Tests

### Unit Test Example

```typescript
import { AuthService } from "../../services/auth.service";

jest.mock("../../config/database");

describe("AuthService", () => {
  it("should register user successfully", async () => {
    const result = await AuthService.register({
      email: "test@example.com",
      password: "password123",
      firstName: "Test",
      lastName: "User",
      role: "mentee",
    });

    expect(result.userId).toBeDefined();
    expect(result.accessToken).toBeDefined();
  });
});
```

### Integration Test Example

```typescript
import { testPool } from "../setup/integrationSetup";
import { PaymentsService } from "../../services/payments.service";

describe("Payment Flow", () => {
  it("should process payment end-to-end", async () => {
    // Create test data
    const user = await testPool.query(
      "INSERT INTO users (...) VALUES (...) RETURNING id"
    );

    // Test payment flow
    const payment = await PaymentsService.initiatePayment({
      userId: user.rows[0].id,
      bookingId: "booking-123",
      amount: "100.0000000",
    });

    expect(payment.status).toBe("pending");
  });
});
```

## Test Types

### 1. Unit Tests
- Test individual functions/methods
- Mock all external dependencies
- Fast execution (< 10 seconds)
- Located in `src/__tests__/services/` and `src/__tests__/controllers/`

### 2. Integration Tests
- Test multiple components together
- Use real database (testcontainers)
- Mock external APIs only
- Located in `src/__tests__/integration/`

### 3. E2E Tests
- Test complete user journeys
- Use real database and Redis
- Mock only external services
- Located in `src/__tests__/e2e/`

## CI/CD Integration

### GitHub Actions
Every PR triggers:
1. Unit tests with coverage
2. Integration tests
3. E2E tests
4. Coverage threshold checks
5. PR comment with coverage report

### Coverage Enforcement
Build fails if:
- Overall coverage < 80%
- Auth service coverage < 90%
- Payments service coverage < 90%
- Escrow service coverage < 90%

## Best Practices

### DO ✅
- Write tests for all new features
- Test both success and error paths
- Use descriptive test names
- Keep tests isolated
- Mock external dependencies
- Clean up after tests

### DON'T ❌
- Skip tests to pass CI
- Test implementation details
- Share state between tests
- Use real external services
- Ignore failing tests

## Debugging Tests

### Run Single Test
```bash
npm test -- auth.service.unit.test.ts
```

### Run Specific Test Case
```bash
npm test -- -t "should login user successfully"
```

### View Coverage Report
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Test Data

### Factories
Use factories for consistent test data:

```typescript
import { createUser } from "../factories/user.factory";

const user = createUser({ role: "mentor" });
```

### Database Setup
Integration tests use testcontainers:
- PostgreSQL 15
- Redis 7
- Automatic cleanup between tests

## Common Patterns

### Mocking Database
```typescript
jest.mock("../../config/database");
const mockPool = pool as jest.Mocked<typeof pool>;
mockPool.query.mockResolvedValue({ rows: [{ id: "123" }] });
```

### Testing Async Functions
```typescript
it("should handle async operations", async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### Testing Errors
```typescript
it("should throw error", async () => {
  await expect(functionThatThrows()).rejects.toThrow("Error message");
});
```

## Performance

### Test Execution Times
- Unit tests: ~10-15 seconds
- Integration tests: ~30-45 seconds
- E2E tests: ~45-60 seconds
- Total: ~2-3 minutes

### Optimization Tips
- Use `--runInBand` for integration tests
- Mock expensive operations
- Use test data factories
- Clean up properly after tests

## Documentation

- [Test Coverage Implementation](./TEST_COVERAGE_IMPLEMENTATION.md) - Detailed guide
- [Testing Quick Start](./TESTING_QUICK_START.md) - Quick reference
- [Unit Testing Guide](./UNIT_TESTING_GUIDE.md) - Unit test patterns

## Troubleshooting

### Tests Failing Locally
```bash
# Clear Jest cache
npx jest --clearCache

# Reinstall dependencies
npm ci

# Check environment variables
cp .env.test.example .env.test
```

### Coverage Not Meeting Threshold
1. Run coverage report: `npm run test:coverage`
2. Open HTML report: `open coverage/lcov-report/index.html`
3. Identify uncovered lines (highlighted in red/yellow)
4. Add tests for uncovered code

### Integration Tests Timing Out
1. Increase timeout in `jest.integration.config.ts`
2. Check Docker/testcontainers are running
3. Verify database migrations completed

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Testing Best Practices](https://testingjavascript.com/)
- [Testcontainers](https://node.testcontainers.org/)

## Support

For questions or issues:
1. Check existing tests for patterns
2. Review documentation
3. Ask in team chat
4. Pair with another developer

---

**Current Coverage**: 82% overall, 90%+ for critical services ✅
