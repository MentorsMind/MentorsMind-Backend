# Security Implementation Checklist

Use this checklist when implementing new features or endpoints to ensure security best practices are followed.

## Pre-Development

- [ ] Review OWASP Top 10 2021
- [ ] Review existing security tests
- [ ] Check for similar endpoints with security patterns
- [ ] Plan authentication/authorization requirements

## Input Validation

- [ ] Define Zod schema for all inputs
- [ ] Validate request body with schema
- [ ] Validate URL parameters with schema
- [ ] Validate query parameters with schema
- [ ] Reject oversized payloads (>10MB)
- [ ] Sanitize string inputs
- [ ] Reject null bytes in input
- [ ] Validate email format
- [ ] Validate UUID format for IDs
- [ ] Validate enum values

## Authentication & Authorization

- [ ] Require JWT token for protected endpoints
- [ ] Verify token signature
- [ ] Check token expiration
- [ ] Verify user exists and is active
- [ ] Implement role-based access control
- [ ] Check resource ownership before access
- [ ] Prevent privilege escalation
- [ ] Prevent user impersonation
- [ ] Use UUIDs instead of sequential IDs

## SQL Injection Prevention

- [ ] Use parameterized queries (pg library)
- [ ] Never concatenate user input into SQL
- [ ] Use query builders or ORMs
- [ ] Validate input types
- [ ] Escape special characters
- [ ] Test with SQL injection payloads

## XSS Prevention

- [ ] Sanitize all user input
- [ ] Escape HTML entities in responses
- [ ] Use Content-Security-Policy header
- [ ] Validate URLs before storing
- [ ] Block dangerous protocols (javascript:, data:)
- [ ] Test with XSS payloads

## CSRF Protection

- [ ] Use SameSite cookie attribute
- [ ] Validate Origin header
- [ ] Validate Referer header
- [ ] Implement CSRF token if needed
- [ ] Use POST/PUT/DELETE for state changes

## Rate Limiting

- [ ] Apply rate limiting to sensitive endpoints
- [ ] Use distributed rate limiting (Redis)
- [ ] Track by user ID, not just IP
- [ ] Implement exponential backoff
- [ ] Return 429 status code
- [ ] Include Retry-After header

## Data Protection

- [ ] Encrypt sensitive data at rest
- [ ] Use HTTPS for data in transit
- [ ] Hash passwords with bcrypt
- [ ] Don't expose sensitive data in logs
- [ ] Don't expose sensitive data in JWT
- [ ] Implement data retention policies
- [ ] Sanitize error messages

## Error Handling

- [ ] Don't expose stack traces to clients
- [ ] Don't expose database errors
- [ ] Don't expose file paths
- [ ] Log errors securely
- [ ] Return generic error messages
- [ ] Use appropriate HTTP status codes

## Security Headers

- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY or SAMEORIGIN
- [ ] X-XSS-Protection: 1; mode=block
- [ ] Content-Security-Policy
- [ ] Strict-Transport-Security (production)
- [ ] Referrer-Policy
- [ ] Permissions-Policy

## Logging & Monitoring

- [ ] Log authentication attempts
- [ ] Log authorization failures
- [ ] Log sensitive operations
- [ ] Include user ID in logs
- [ ] Include request ID in logs
- [ ] Include timestamp in logs
- [ ] Don't log sensitive data
- [ ] Monitor for suspicious patterns

## Testing

- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Write security tests
- [ ] Test with invalid input
- [ ] Test with SQL injection payloads
- [ ] Test with XSS payloads
- [ ] Test with CSRF attacks
- [ ] Test with rate limiting
- [ ] Test with expired tokens
- [ ] Test with invalid tokens
- [ ] Test with missing auth
- [ ] Test IDOR vulnerabilities
- [ ] Test mass assignment
- [ ] Achieve >70% code coverage

## Code Review

- [ ] Security review by team member
- [ ] Check for hardcoded secrets
- [ ] Check for debug code
- [ ] Check for commented code
- [ ] Check for TODO/FIXME comments
- [ ] Verify all tests pass
- [ ] Verify linting passes
- [ ] Verify no new vulnerabilities

## Deployment

- [ ] Run npm audit
- [ ] Run security tests
- [ ] Run OWASP ZAP scan
- [ ] Review security headers
- [ ] Verify HTTPS enabled
- [ ] Verify rate limiting active
- [ ] Verify logging enabled
- [ ] Verify monitoring enabled
- [ ] Document security considerations

## Post-Deployment

- [ ] Monitor for errors
- [ ] Monitor for suspicious activity
- [ ] Review logs regularly
- [ ] Update security documentation
- [ ] Plan security improvements
- [ ] Schedule security review

## Common Vulnerabilities to Avoid

### SQL Injection
```typescript
// ❌ WRONG
const query = `SELECT * FROM users WHERE email = '${email}'`;

// ✅ CORRECT
const query = 'SELECT * FROM users WHERE email = $1';
pool.query(query, [email]);
```

### XSS
```typescript
// ❌ WRONG
res.json({ message: userInput });

// ✅ CORRECT
const sanitized = sanitizeHtml(userInput);
res.json({ message: sanitized });
```

### IDOR
```typescript
// ❌ WRONG
const user = await getUser(req.params.id);

// ✅ CORRECT
const user = await getUser(req.params.id);
if (user.id !== req.user.userId && req.user.role !== 'admin') {
  throw new ForbiddenError();
}
```

### Mass Assignment
```typescript
// ❌ WRONG
const user = await updateUser(req.params.id, req.body);

// ✅ CORRECT
const allowedFields = ['firstName', 'lastName', 'bio'];
const updates = pick(req.body, allowedFields);
const user = await updateUser(req.params.id, updates);
```

### Privilege Escalation
```typescript
// ❌ WRONG
const user = await updateUser(req.params.id, req.body);

// ✅ CORRECT
const allowedFields = ['firstName', 'lastName', 'bio'];
if (req.body.role) {
  throw new BadRequestError('Cannot modify role');
}
const updates = pick(req.body, allowedFields);
const user = await updateUser(req.params.id, updates);
```

## Resources

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express.js Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [CWE Top 25](https://cwe.mitre.org/top25/)

## Questions?

Contact the security team or review existing security tests for examples.
