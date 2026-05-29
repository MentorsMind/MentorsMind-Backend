# MentorMinds API Structure & Conventions

## Overview
Robust Express.js/TS API with middleware-first architecture, API versioning, Swagger docs, comprehensive security.

## Middleware Stack (src/app.ts order)
```
1. IP Blocklist (ipFilter.middleware.ts)
2. Tracing (tracing.middleware.ts - OpenTelemetry)
3. Security (security.middleware.ts - Helmet, CSP, HSTS)
4. CORS (cors.middleware.ts)
5. Request Logging (request-logger.middleware.ts - pino-http)
6. Body Parsing (express.json/urlencoded, 10MB limit)
7. Sanitization (sanitizeInput)
8. Rate Limiting (rate-limit.middleware.ts - Redis-backed)
9. Metrics (metrics.middleware.ts - Prometheus)
10. Versioning (versioning.middleware.ts)
11. Routes + Health/Swagger
12. 404 Handler
13. Error Handler (errorHandler.ts)
```

## Routing & Versioning
- `/api/v1` (stable): src/routes/v1/*
- `/api/v2` (active): src/routes/v2/*
- `/api/versions` - Version info
- Health: `/health/{live,ready,detailed}` (admin auth)
- Docs: `/api/{v1|v2}/docs` (Swagger UI)

## Validation
- Zod schemas (schemas/*.ts)
- validation.middleware.ts

## Security Best Practices
- Helmet (XSS/CSRF protection)
- Rate limits (general/user/IP/endpoint)
- JWT auth + refresh (auth.middleware.ts)
- RBAC (rbac.middleware.ts)
- Audit logging
- Input sanitization
- Secrets mgmt (config/secrets.ts)

## Response Conventions
- `{ status: 'success/error', data: {}, meta: {} }`
- HTTP 2xx/4xx/5xx strict
- See src/utils/response.utils.ts

## Testing
- Unit: jest.unit.config.ts (middleware/utils)
- Integration: jest.integration.config.ts
- Contract: openapi.json + jest.contract.config.ts

## Deployment Notes
- `npm run build && npm start`
- Docker: docker-compose.yml

