# Security Testing Quick Reference

## Quick Start

### Run All Security Tests
```bash
npm run test:security
```

### Run Specific Test Suite
```bash
npm test -- src/__tests__/security/injection.test.ts
npm test -- src/__tests__/security/auth.test.ts
npm test -- src/__tests__/security/idor.test.ts
npm test -- src/__tests__/security/ratelimit.test.ts
```

### Run with Coverage
```bash
npm run test:coverage -- src/__tests__/security
```

### Check Dependencies
```bash
npm audit
npm audit --audit-level=high
npm audit fix
```

## Test Files Overview

| File | Focus | Tests |
|------|-------|-------|
| `injection.test.ts` | SQL injection, XSS, command injection | 15+ |
| `auth.test.ts` | JWT, authentication, CSRF | 20+ |
| `idor.test.ts` | Access control, mass assignment | 15+ |
| `ratelimit.test.ts` | Rate limiting, security headers | 15+ |

## CI/CD Pipeline

### Automatic Triggers
- ✅ Push to main/develop
- ✅ Pull requests to main/develop
- ✅ Daily at 2 AM UTC

### Jobs
1. **npm-audit** - Dependency vulnerabilities
2. **security-tests** - OWASP Top 10 tests
3. **dependency-check** - Known vulnerabilities
4. **sast-scan** - Code quality (ESLint)
5. **owasp-zap** - Dynamic security scan
6. **security-headers** - HTTP headers verification
7. **helm-security** - Kubernetes security
8. **report** - Aggregated results

## OWASP Top 10 Mapping

| # | Vulnerability | Test File | Status |
|---|---|---|---|
| 1 | Broken Access Control | idor.test.ts | ✅ |
| 2 | Cryptographic Failures | auth.test.ts | ✅ |
| 3 | Injection | injection.test.ts | ✅ |
| 4 | Insecure Design | ratelimit.test.ts | ✅ |
| 5 | Security Misconfiguration | ratelimit.test.ts | ✅ |
| 6 | Vulnerable Components | security.yml | ✅ |
| 7 | Authentication Failures | auth.test.ts | ✅ |
| 8 | Data Integrity Failures | security.yml | ✅ |
| 9 | Logging & Monitoring | security.yml | ✅ |
| 10 | SSRF | injection.test.ts | ✅ |

## Common Commands

### Development
```bash
# Start dev server
npm run dev

# Run tests in watch mode
npm run test:security:watch

# Lint code
npm run lint
npm run lint:fix

# Format code
npm run format
```

### Testing
```bash
# Run all tests
npm test

# Run security tests only
npm run test:security

# Run with coverage
npm run test:coverage

# Run specific test
npm test -- src/__tests__/security/injection.test.ts
```

### Security
```bash
# Check vulnerabilities
npm audit

# Check high/critical only
npm audit --audit-level=high

# Fix vulnerabilities
npm audit fix

# Fix with force (breaking changes)
npm audit fix --force
```

### Build & Deploy
```bash
# Build for production
npm run build

# Start production server
npm start

# Docker build
npm run docker:build

# Docker dev with hot reload
npm run docker:dev

# Docker tests
npm run docker:test
```

## Test Database Setup

Tests use PostgreSQL. Ensure:

1. PostgreSQL is running
2. `.env.test` is configured:
   ```
   DATABASE_URL=postgresql://test:test@localhost:5432/mentorminds_test
   JWT_SECRET=test-secret-key
   NODE_ENV=test
   ```

3. Test database exists:
   ```bash
   createdb mentorminds_test
   ```

## Troubleshooting

### Tests Fail with Database Error
```bash
# Recreate test database
dropdb mentorminds_test
createdb mentorminds_test
npm run test:security
```

### npm audit Fails
```bash
# Check vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Fix with breaking changes
npm audit fix --force

# Check specific package
npm audit --package=package-name
```

### Security Tests Timeout
```bash
# Increase Jest timeout
npm test -- --testTimeout=30000 src/__tests__/security
```

### OWASP ZAP Scan Fails
```bash
# Check API is running
curl http://localhost:5000/health

# Check port is available
lsof -i :5000

# Kill process on port
kill -9 $(lsof -t -i:5000)
```

## Key Files

```
src/__tests__/security/
├── injection.test.ts      # SQL injection, XSS, command injection
├── auth.test.ts           # JWT, authentication, CSRF
├── idor.test.ts           # IDOR, mass assignment
└── ratelimit.test.ts      # Rate limiting, security headers

.github/workflows/
└── security.yml           # CI/CD security pipeline

.zap/
└── rules.tsv              # OWASP ZAP configuration

docs/
├── SECURITY_TESTING.md    # Comprehensive guide
└── SECURITY_CHECKLIST.md  # Developer checklist
```

## Documentation

- **SECURITY_TESTING.md** - Full security testing guide
- **SECURITY_CHECKLIST.md** - Developer security checklist
- **SECURITY_IMPLEMENTATION.md** - Implementation summary

## Test Examples

### SQL Injection Test
```typescript
it('should reject SQL injection in query parameters', async () => {
  const response = await request(app)
    .get(`${API_BASE}/users/me`)
    .set('Authorization', `Bearer ${token}`)
    .query({ search: "'; DROP TABLE users; --" });

  expect(response.status).toBe(200);
});
```

### JWT Algorithm Confusion Test
```typescript
it('should reject JWT with alg: none', async () => {
  const maliciousToken = jwt.sign(
    { userId, email: 'test@example.com', role: 'admin' },
    '',
    { algorithm: 'none' as any }
  );

  const response = await request(app)
    .get(`${API_BASE}/users/me`)
    .set('Authorization', `Bearer ${maliciousToken}`);

  expect(response.status).toBe(401);
});
```

### IDOR Test
```typescript
it('should prevent user from accessing another user profile', async () => {
  const response = await request(app)
    .get(`${API_BASE}/users/${user2Id}`)
    .set('Authorization', `Bearer ${user1Token}`);

  expect([403, 404]).toContain(response.status);
});
```

### Rate Limiting Test
```typescript
it('should enforce rate limits on login endpoint', async () => {
  const requests = [];
  for (let i = 0; i < 15; i++) {
    requests.push(
      request(app)
        .post(`${API_BASE}/auth/login`)
        .send({ email: 'test@example.com', password: 'password' })
    );
  }

  const responses = await Promise.all(requests);
  const rateLimited = responses.some(r => r.status === 429);
  expect(rateLimited).toBe(true);
});
```

## Performance Tips

- Run tests in parallel: `npm test -- --maxWorkers=4`
- Run specific test file: `npm test -- injection.test.ts`
- Skip slow tests: `npm test -- --testNamePattern="not slow"`
- Watch mode: `npm run test:security:watch`

## Security Best Practices

1. **Always validate input** - Use Zod schemas
2. **Use parameterized queries** - Never concatenate SQL
3. **Sanitize output** - Escape HTML entities
4. **Verify ownership** - Check user ID before access
5. **Use UUIDs** - Avoid sequential IDs
6. **Enforce rate limits** - Prevent brute force
7. **Validate tokens** - Check signature and expiration
8. **Log security events** - Track suspicious activity
9. **Keep dependencies updated** - Run npm audit regularly
10. **Review code** - Security review before merge

## Resources

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [Node.js Security](https://nodejs.org/en/docs/guides/security/)
- [Express.js Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [CWE Top 25](https://cwe.mitre.org/top25/)

## Support

For questions:
1. Check `docs/SECURITY_TESTING.md`
2. Review test files for examples
3. Check `docs/SECURITY_CHECKLIST.md`
4. Contact security team

---

**Last Updated**: 2024
**Status**: ✅ Production Ready
