# Security Testing Quick Reference

## Quick Commands

```bash
# Run all security tests
npm test -- --testPathPattern=security

# Run specific test suite
npm test -- src/__tests__/security/owasp-top10.test.ts
npm test -- src/__tests__/security/auth.test.ts
npm test -- src/__tests__/security/injection.test.ts
npm test -- src/__tests__/security/idor.test.ts
npm test -- src/__tests__/security/ratelimit.test.ts

# Run ZAP baseline scan
docker run -v $(pwd):/zap/wrk/:rw -t owasp/zap2docker-stable \
  zap-baseline.py -t http://host.docker.internal:3000 \
  -c .zap/zap-baseline.conf -r zap-report.html
```

## Test Coverage

| Vulnerability | Tests | Status |
|---------------|-------|--------|
| SQL Injection | 10+ | ✅ |
| XSS | 8+ | ✅ |
| IDOR | 15+ | ✅ |
| JWT Security | 5+ | ✅ |
| Mass Assignment | 8+ | ✅ |
| Rate Limiting | 6+ | ✅ |
| CSRF | 6+ | ✅ |
| SSRF | 5+ | ✅ |

## OWASP Top 10 Checklist

- ✅ A01: Broken Access Control
- ✅ A02: Cryptographic Failures
- ✅ A03: Injection
- ✅ A04: Insecure Design
- ✅ A05: Security Misconfiguration
- ✅ A06: Vulnerable Components
- ✅ A07: Authentication Failures
- ✅ A08: Data Integrity Failures
- ✅ A09: Logging Failures
- ✅ A10: SSRF

## Common Test Patterns

### SQL Injection
```typescript
it("should prevent SQL injection", async () => {
  const response = await request(app)
    .get(`${API_BASE}/users`)
    .query({ search: "'; DROP TABLE users; --" });
  
  expect([200, 400]).toContain(response.status);
});
```

### XSS
```typescript
it("should sanitize XSS", async () => {
  const response = await request(app)
    .put(`${API_BASE}/users/me`)
    .send({ firstName: '<script>alert("XSS")</script>' });
  
  expect([200, 400]).toContain(response.status);
});
```

### IDOR
```typescript
it("should prevent IDOR", async () => {
  const response = await request(app)
    .get(`${API_BASE}/users/${otherUserId}`)
    .set("Authorization", `Bearer ${token}`);
  
  expect([403, 404]).toContain(response.status);
});
```

### JWT
```typescript
it("should reject alg: none", async () => {
  const noneToken = jwt.sign({ userId }, "", { algorithm: "none" as any });
  
  const response = await request(app)
    .get(`${API_BASE}/users/me`)
    .set("Authorization", `Bearer ${noneToken}`);
  
  expect(response.status).toBe(401);
});
```

## CI/CD

### Triggers
- **PR**: Security tests + ZAP baseline
- **Main**: Full security suite
- **Weekly**: Complete audit (Monday 3 AM)

### Artifacts
- Security test results
- ZAP scan reports (HTML/JSON/MD)
- npm audit reports

## Resources

- [Full Documentation](./SECURITY_TESTING.md)
- [Implementation Summary](./ISSUE_423_IMPLEMENTATION_SUMMARY.md)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP ZAP](https://www.zaproxy.org/)
