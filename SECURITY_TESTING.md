# Security Testing Guide

## Overview

This project implements comprehensive security testing based on the OWASP Top 10 vulnerabilities, including automated security scans with OWASP ZAP.

## Quick Start

```bash
# Run all security tests
npm test -- --testPathPattern=security

# Run specific security test suite
npm test -- src/__tests__/security/owasp-top10.test.ts

# Run OWASP ZAP baseline scan (requires Docker)
docker run -v $(pwd):/zap/wrk/:rw -t owasp/zap2docker-stable zap-baseline.py \
  -t http://host.docker.internal:3000 \
  -c .zap/zap-baseline.conf \
  -r zap-report.html
```

## Security Test Coverage

### OWASP Top 10 (2021)

#### A01:2021 – Broken Access Control
- ✅ IDOR (Insecure Direct Object References) prevention
- ✅ Privilege escalation prevention
- ✅ Mass assignment prevention
- ✅ Horizontal access control
- ✅ Vertical access control

**Tests**: 15+ test cases covering all :id endpoints

#### A02:2021 – Cryptographic Failures
- ✅ Sensitive data exposure prevention
- ✅ Password hash protection
- ✅ JWT secret protection
- ✅ Strong cryptography enforcement
- ✅ Weak algorithm rejection

**Tests**: 8+ test cases

#### A03:2021 – Injection
- ✅ SQL injection prevention
- ✅ XSS (Cross-Site Scripting) prevention
- ✅ Command injection prevention
- ✅ NoSQL injection prevention
- ✅ Path traversal prevention

**Tests**: 20+ test cases covering all text inputs

#### A04:2021 – Insecure Design
- ✅ Business logic flaw prevention
- ✅ Input validation
- ✅ Rate limiting
- ✅ Resource limits

**Tests**: 5+ test cases

#### A05:2021 – Security Misconfiguration
- ✅ Security headers (X-Content-Type-Options, X-Frame-Options, CSP, etc.)
- ✅ Error handling (no stack traces in production)
- ✅ Default credentials prevention
- ✅ Unnecessary features disabled

**Tests**: 10+ test cases

#### A06:2021 – Vulnerable and Outdated Components
- ✅ Dependency scanning (npm audit)
- ✅ Version disclosure prevention
- ✅ Automated vulnerability detection

**Tests**: CI/CD integration

#### A07:2021 – Identification and Authentication Failures
- ✅ JWT algorithm confusion prevention
- ✅ Token expiration enforcement
- ✅ Session management
- ✅ Brute force protection
- ✅ Credential stuffing prevention

**Tests**: 15+ test cases

#### A08:2021 – Software and Data Integrity Failures
- ✅ Prototype pollution prevention
- ✅ Content integrity validation
- ✅ Unsigned/unverified updates prevention

**Tests**: 3+ test cases

#### A09:2021 – Security Logging and Monitoring Failures
- ✅ Authentication failure logging
- ✅ Authorization failure logging
- ✅ Security event monitoring

**Tests**: 5+ test cases

#### A10:2021 – Server-Side Request Forgery (SSRF)
- ✅ SSRF prevention via URL validation
- ✅ Internal IP blocking
- ✅ Metadata endpoint protection

**Tests**: 5+ test cases

## Test Suites

### 1. OWASP Top 10 Tests
**File**: `src/__tests__/security/owasp-top10.test.ts`

Comprehensive tests covering all OWASP Top 10 vulnerabilities.

```bash
npm test -- src/__tests__/security/owasp-top10.test.ts
```

### 2. Authentication & JWT Tests
**File**: `src/__tests__/security/auth.test.ts`

Tests for authentication mechanisms and JWT security.

```bash
npm test -- src/__tests__/security/auth.test.ts
```

### 3. Injection Prevention Tests
**File**: `src/__tests__/security/injection.test.ts`

Tests for SQL injection, XSS, and command injection prevention.

```bash
npm test -- src/__tests__/security/injection.test.ts
```

### 4. IDOR & Mass Assignment Tests
**File**: `src/__tests__/security/idor.test.ts`

Tests for access control and mass assignment vulnerabilities.

```bash
npm test -- src/__tests__/security/idor.test.ts
```

### 5. Rate Limiting Tests
**File**: `src/__tests__/security/ratelimit.test.ts`

Tests for rate limiting and CSRF protection.

```bash
npm test -- src/__tests__/security/ratelimit.test.ts
```

## OWASP ZAP Integration

### Baseline Scan
Quick passive scan for common vulnerabilities.

```bash
# Using Docker
docker run -v $(pwd):/zap/wrk/:rw -t owasp/zap2docker-stable \
  zap-baseline.py \
  -t http://host.docker.internal:3000 \
  -c .zap/zap-baseline.conf \
  -r zap-baseline-report.html

# Using ZAP CLI
zap-baseline.py \
  -t http://localhost:3000 \
  -c .zap/zap-baseline.conf \
  -r zap-baseline-report.html
```

### API Scan
Comprehensive active scan using OpenAPI specification.

```bash
# Using Docker
docker run -v $(pwd):/zap/wrk/:rw -t owasp/zap2docker-stable \
  zap-api-scan.py \
  -t http://host.docker.internal:3000 \
  -f openapi \
  -c .zap/zap-api-scan.conf \
  -r zap-api-report.html

# Using ZAP CLI
zap-api-scan.py \
  -t http://localhost:3000 \
  -f openapi \
  -c .zap/zap-api-scan.conf \
  -r zap-api-report.html
```

### Full Scan
Comprehensive active scan (use with caution).

```bash
docker run -v $(pwd):/zap/wrk/:rw -t owasp/zap2docker-stable \
  zap-full-scan.py \
  -t http://host.docker.internal:3000 \
  -r zap-full-report.html
```

## CI/CD Integration

### GitHub Actions Workflow
Security scans run automatically on:
- **Pull Requests**: Security tests + ZAP baseline scan
- **Push to Main**: Full security suite + ZAP API scan
- **Weekly Schedule**: Complete security audit (Monday 3 AM UTC)

### Workflow Jobs

1. **security-tests**: Run Jest security test suites
2. **zap-baseline-scan**: OWASP ZAP passive scan
3. **zap-api-scan**: OWASP ZAP active API scan (main branch only)
4. **dependency-check**: npm audit for vulnerable dependencies
5. **security-summary**: Aggregate results and create summary

### Viewing Results

Results are available in:
- GitHub Actions workflow summary
- Uploaded artifacts (HTML/JSON/MD reports)
- PR comments (for baseline scans)

## Security Test Patterns

### Testing IDOR
```typescript
it("should prevent accessing other user's resource", async () => {
  const response = await request(app)
    .get(`${API_BASE}/users/${otherUserId}`)
    .set("Authorization", `Bearer ${token}`);

  expect([403, 404]).toContain(response.status);
});
```

### Testing SQL Injection
```typescript
it("should prevent SQL injection", async () => {
  const response = await request(app)
    .get(`${API_BASE}/users`)
    .query({ search: "'; DROP TABLE users; --" });

  expect([200, 400]).toContain(response.status);

  // Verify table still exists
  const tableCheck = await testPool.query(
    `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='users')`
  );
  expect(tableCheck.rows[0].exists).toBe(true);
});
```

### Testing XSS
```typescript
it("should sanitize XSS payloads", async () => {
  const response = await request(app)
    .put(`${API_BASE}/users/me`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      firstName: '<script>alert("XSS")</script>',
      lastName: "User",
    });

  expect([200, 400]).toContain(response.status);

  if (response.status === 200) {
    const userResponse = await request(app)
      .get(`${API_BASE}/users/me`)
      .set("Authorization", `Bearer ${token}`);

    expect(userResponse.body.data.firstName).not.toContain("<script>");
  }
});
```

### Testing JWT Security
```typescript
it("should reject JWT with alg: none", async () => {
  const noneToken = jwt.sign(
    { userId, role: "admin" },
    "",
    { algorithm: "none" as any }
  );

  const response = await request(app)
    .get(`${API_BASE}/users/me`)
    .set("Authorization", `Bearer ${noneToken}`);

  expect(response.status).toBe(401);
});
```

### Testing Mass Assignment
```typescript
it("should prevent mass assignment of protected fields", async () => {
  const response = await request(app)
    .put(`${API_BASE}/users/me`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      firstName: "Updated",
      role: "admin",  // Protected field
      isActive: false,  // Protected field
    });

  expect([200, 400]).toContain(response.status);

  // Verify protected fields unchanged
  const userCheck = await testPool.query(
    `SELECT role, is_active FROM users WHERE id = $1`,
    [userId]
  );
  expect(userCheck.rows[0].role).not.toBe("admin");
});
```

## Security Checklist

### Before Deployment
- [ ] All security tests passing
- [ ] ZAP baseline scan clean
- [ ] No critical/high npm audit vulnerabilities
- [ ] Security headers configured
- [ ] Rate limiting enabled
- [ ] HTTPS enforced
- [ ] CORS properly configured
- [ ] Input validation on all endpoints
- [ ] Authentication on protected routes
- [ ] Authorization checks on all resources

### Regular Maintenance
- [ ] Weekly ZAP scans
- [ ] Monthly dependency updates
- [ ] Quarterly security audit
- [ ] Review security logs
- [ ] Update security policies
- [ ] Penetration testing (annually)

## Common Vulnerabilities

### SQL Injection
**Prevention**:
- Use parameterized queries
- Use ORM/query builders
- Validate and sanitize input
- Principle of least privilege for DB users

**Example**:
```typescript
// ❌ Vulnerable
const query = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ Safe
const query = `SELECT * FROM users WHERE email = $1`;
await pool.query(query, [email]);
```

### XSS (Cross-Site Scripting)
**Prevention**:
- Sanitize all user input
- Escape output
- Use Content Security Policy
- Validate input format

**Example**:
```typescript
// ❌ Vulnerable
res.send(`<h1>Welcome ${username}</h1>`);

// ✅ Safe
res.json({ message: `Welcome ${sanitize(username)}` });
```

### IDOR (Insecure Direct Object References)
**Prevention**:
- Verify ownership before access
- Use UUIDs instead of sequential IDs
- Implement proper authorization
- Check user permissions

**Example**:
```typescript
// ❌ Vulnerable
const user = await getUserById(req.params.id);

// ✅ Safe
const user = await getUserById(req.params.id);
if (user.id !== req.user.id && req.user.role !== 'admin') {
  throw new ForbiddenError();
}
```

### JWT Algorithm Confusion
**Prevention**:
- Explicitly specify algorithm
- Reject "none" algorithm
- Validate algorithm in verification
- Use strong secrets

**Example**:
```typescript
// ❌ Vulnerable
jwt.verify(token, secret);

// ✅ Safe
jwt.verify(token, secret, { algorithms: ['HS256'] });
```

## Troubleshooting

### Tests Failing
```bash
# Check database connection
psql $DATABASE_URL -c "SELECT 1"

# Check Redis connection
redis-cli ping

# View detailed test output
npm test -- --verbose src/__tests__/security/
```

### ZAP Scan Issues
```bash
# Check server is running
curl http://localhost:3000/api/health

# View ZAP logs
docker logs <container-id>

# Run with debug output
docker run -v $(pwd):/zap/wrk/:rw -t owasp/zap2docker-stable \
  zap-baseline.py -t http://host.docker.internal:3000 -d
```

### False Positives
Add to `.zap/zap-baseline.conf`:
```
# Format: alert_id	url_regex	parameter	cwe_id	wascid
10096	http://localhost:3000/api/.*	timestamp	.*	.*
```

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP ZAP Documentation](https://www.zaproxy.org/docs/)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [JWT Security Best Practices](https://tools.ietf.org/html/rfc8725)
- [SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)

## Support

For security issues:
1. **DO NOT** create public GitHub issues
2. Email security@mentorminds.com
3. Use responsible disclosure
4. Allow 90 days for fix before public disclosure

---

**Security is everyone's responsibility. Test early, test often!** 🔒
