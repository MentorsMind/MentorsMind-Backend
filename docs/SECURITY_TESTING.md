# Security Testing & OWASP Top 10 Coverage

This document outlines the security testing strategy and OWASP Top 10 vulnerability coverage for the MentorMinds Stellar API.

## Overview

The security testing suite covers the OWASP Top 10 2021 vulnerabilities with automated tests and CI/CD integration:

1. **Broken Access Control** (IDOR, CSRF)
2. **Cryptographic Failures** (JWT security)
3. **Injection** (SQL, XSS, Command)
4. **Insecure Design** (Rate limiting, input validation)
5. **Security Misconfiguration** (Headers, CORS)
6. **Vulnerable & Outdated Components** (npm audit)
7. **Authentication Failures** (JWT algorithm confusion)
8. **Software & Data Integrity Failures** (Dependency checks)
9. **Logging & Monitoring Failures** (Audit logging)
10. **Server-Side Request Forgery (SSRF)** (URL validation)

## Test Files

### 1. `src/__tests__/security/injection.test.ts`
Tests for injection vulnerabilities (OWASP #3):

- **SQL Injection Prevention**
  - DROP TABLE injection
  - DELETE injection
  - UNION-based injection
  - Time-based blind injection

- **XSS Prevention**
  - Script tag sanitization
  - Event handler sanitization
  - JavaScript protocol blocking
  - Data protocol blocking
  - HTML entity escaping

- **NoSQL Injection Prevention**
  - Object injection detection

- **Command Injection Prevention**
  - Shell metacharacter filtering
  - Backtick command substitution blocking

- **Path Traversal Prevention**
  - Directory traversal detection

### 2. `src/__tests__/security/auth.test.ts`
Tests for authentication & JWT vulnerabilities (OWASP #2, #7):

- **JWT Algorithm Confusion**
  - `alg: none` rejection
  - HS256/RS256 confusion detection
  - Invalid signature detection
  - Expired token rejection
  - Payload tampering detection

- **Authentication Bypass**
  - Missing Bearer token rejection
  - Missing Authorization header rejection
  - Empty token rejection
  - Malformed JWT rejection
  - Null byte injection rejection

- **Token Refresh Security**
  - Revoked token rejection
  - Invalid refresh token signature rejection

- **CSRF Protection**
  - CSRF token requirement
  - Cross-origin request blocking
  - SameSite cookie enforcement

- **Session Security**
  - Sensitive data exclusion from JWT
  - Token expiration enforcement

- **Privilege Escalation Prevention**
  - Role modification prevention
  - User impersonation prevention

### 3. `src/__tests__/security/idor.test.ts`
Tests for access control vulnerabilities (OWASP #1):

- **IDOR on User Endpoints**
  - Cross-user profile access prevention
  - Cross-user profile update prevention
  - Cross-user deletion prevention
  - Admin access verification

- **IDOR on Wallet Endpoints**
  - Cross-user wallet access prevention
  - Cross-user wallet update prevention

- **IDOR on Session/Booking Endpoints**
  - Cross-user session access prevention
  - Cross-user session update prevention

- **Mass Assignment Prevention**
  - Internal field protection (isActive, createdAt)
  - Admin-only field protection
  - Wallet field protection
  - Transaction field protection

- **IDOR on Transaction Endpoints**
  - Cross-user transaction access prevention
  - Cross-user transaction cancellation prevention

- **Numeric ID Enumeration Prevention**
  - UUID format verification
  - Sequential ID rejection

### 4. `src/__tests__/security/ratelimit.test.ts`
Tests for rate limiting & CSRF (OWASP #4, #5):

- **Rate Limiting**
  - Login endpoint rate limiting
  - Registration endpoint rate limiting
  - API endpoint rate limiting
  - X-Forwarded-For spoofing prevention
  - User-Agent spoofing prevention
  - Rate limit window reset verification

- **CSRF Protection**
  - CSRF token inclusion
  - State-changing request validation
  - SameSite cookie enforcement
  - Origin mismatch rejection
  - Referer validation

- **Security Headers**
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: DENY/SAMEORIGIN
  - X-XSS-Protection
  - Strict-Transport-Security (production)
  - Content-Security-Policy

- **Input Validation**
  - Oversized payload rejection
  - Invalid content-type rejection
  - Null byte rejection

## CI/CD Integration

### GitHub Actions Workflow: `.github/workflows/security.yml`

The security workflow runs on:
- Push to main/develop branches
- Pull requests to main/develop
- Daily schedule (2 AM UTC)

#### Jobs:

1. **npm-audit**
   - Runs `npm audit --audit-level=high`
   - Fails on high/critical vulnerabilities
   - Generates audit report artifact

2. **security-tests**
   - Runs all security test suites
   - Requires PostgreSQL service
   - Uploads coverage reports

3. **dependency-check**
   - Checks for known vulnerabilities
   - Verifies outdated packages
   - Production dependencies only

4. **sast-scan**
   - Runs ESLint with security rules
   - Identifies code quality issues

5. **owasp-zap**
   - Baseline security scan
   - Starts API server
   - Generates HTML report
   - Fails on high/critical alerts

6. **security-headers**
   - Verifies security headers
   - Checks Helmet.js configuration
   - Validates CORS settings

7. **helm-security**
   - Lints Helm charts
   - Checks for privileged containers
   - Validates security context

8. **report**
   - Aggregates all security results
   - Comments on PRs
   - Fails if any check failed

## Running Security Tests Locally

### Run all security tests:
```bash
npm test -- src/__tests__/security
```

### Run specific test suite:
```bash
npm test -- src/__tests__/security/injection.test.ts
npm test -- src/__tests__/security/auth.test.ts
npm test -- src/__tests__/security/idor.test.ts
npm test -- src/__tests__/security/ratelimit.test.ts
```

### Run with coverage:
```bash
npm run test:coverage -- src/__tests__/security
```

### Run npm audit:
```bash
npm audit
npm audit --audit-level=high
```

## Security Best Practices Implemented

### 1. Input Validation
- Zod schema validation on all endpoints
- Type-safe request/response handling
- Sanitization middleware

### 2. Authentication & Authorization
- JWT with HS256 algorithm
- Token expiration enforcement
- Role-based access control (RBAC)
- Refresh token rotation

### 3. Data Protection
- Parameterized queries (pg library)
- SQL injection prevention
- XSS output encoding
- CSRF token validation

### 4. Rate Limiting
- Express rate limit middleware
- Redis-backed distributed rate limiting
- Per-endpoint configuration
- IP-based tracking

### 5. Security Headers
- Helmet.js for HTTP security headers
- CORS configuration
- CSP policy
- HSTS enforcement

### 6. Logging & Monitoring
- Audit logging for sensitive operations
- Request/response logging
- Error tracking with Sentry
- Metrics collection

### 7. Dependency Management
- npm audit in CI/CD
- Automated vulnerability scanning
- Regular dependency updates
- Lock file verification

## Remediation Guidelines

### High/Critical Vulnerabilities

1. **SQL Injection**
   - Always use parameterized queries
   - Never concatenate user input into SQL
   - Use ORM or query builders

2. **XSS**
   - Sanitize all user input
   - Escape output in templates
   - Use Content-Security-Policy

3. **IDOR**
   - Verify user ownership before access
   - Use UUIDs instead of sequential IDs
   - Implement proper authorization checks

4. **Authentication Bypass**
   - Validate JWT signature and expiration
   - Reject `alg: none` tokens
   - Implement token refresh rotation

5. **Rate Limiting Bypass**
   - Use distributed rate limiting
   - Track by user ID, not just IP
   - Implement exponential backoff

## Compliance & Standards

- **OWASP Top 10 2021**: Full coverage
- **CWE Top 25**: Addressed
- **NIST Cybersecurity Framework**: Implemented
- **PCI DSS**: Applicable controls
- **GDPR**: Data protection measures

## Continuous Improvement

1. **Regular Audits**
   - Monthly security reviews
   - Quarterly penetration testing
   - Annual third-party assessment

2. **Dependency Updates**
   - Weekly dependency checks
   - Automated patch management
   - Security advisory monitoring

3. **Incident Response**
   - Security incident procedures
   - Vulnerability disclosure policy
   - Post-incident reviews

## References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express.js Security](https://expressjs.com/en/advanced/best-practice-security.html)

## Support

For security issues:
1. Do not open public issues
2. Email: security@mentorminds.com
3. Follow responsible disclosure policy
4. Allow 90 days for remediation
