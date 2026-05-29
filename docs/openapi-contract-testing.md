# OpenAPI Contract Testing

## Overview

This project uses OpenAPI 3.0 specification for API documentation and contract testing. The spec is generated from JSDoc annotations in route files and used to:

1. Generate interactive API documentation (Swagger UI)
2. Generate TypeScript types for frontend consumption
3. Validate API responses in tests
4. Detect breaking changes in CI/CD

## Architecture

```
┌─────────────────┐
│  JSDoc in       │
│  Routes         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  swagger-jsdoc  │
│  generates      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  openapi.json   │◄─── Committed to repo
└────┬────────┬───┘
     │        │
     │        └──────────────┐
     ▼                       ▼
┌─────────────┐      ┌──────────────┐
│ Swagger UI  │      │ TypeScript   │
│ /api/docs   │      │ Types        │
└─────────────┘      └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Frontend    │
                     │  Consumes    │
                     └──────────────┘
```

## Generating OpenAPI Spec

### From JSDoc Annotations

Add OpenAPI annotations to your routes:

```typescript
/**
 * @swagger
 * /api/v1/users/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/me', authenticate, UsersController.getProfile);
```

### Generate Spec

```bash
npm run generate:spec
```

This creates `openapi.json` at the project root with 64+ documented endpoints.

## Generating TypeScript Types

### Generate Types from Spec

```bash
npm run generate:types
```

This creates `packages/api-types/src/index.ts` with TypeScript interfaces for all API types.

### Using Types in Frontend

```typescript
import { User, LoginRequest, ApiResponse } from '@mentorminds/api-types';

// Type-safe API call
async function login(credentials: LoginRequest): Promise<ApiResponse<{ user: User }>> {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  return response.json();
}
```

## Contract Testing

### Running Contract Tests

```bash
npm run test:contract
```

Contract tests validate:
- OpenAPI spec structure
- Response formats match spec
- All critical endpoints are documented
- Security schemes are defined
- Common schemas exist

### Writing Contract Tests

```typescript
import request from 'supertest';
import app from '../../app';

describe('User API Contract', () => {
  it('should match spec for GET /users/me', async () => {
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);
    
    // Validate response structure
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'success');
    expect(response.body).toHaveProperty('data');
    expect(response.body.data).toHaveProperty('id');
    expect(response.body.data).toHaveProperty('email');
  });
});
```

## Breaking Change Detection

### CI/CD Integration

The GitHub Actions workflow `.github/workflows/openapi-check.yml` automatically:

1. Generates OpenAPI spec from current branch
2. Fetches spec from main branch
3. Compares specs using `openapi-diff`
4. Fails PR if breaking changes detected
5. Comments on PR with change details

### Manual Check

```bash
npm run check:breaking
```

### What Counts as Breaking?

Breaking changes include:
- Removing endpoints
- Removing required fields from responses
- Adding required fields to requests
- Changing field types
- Removing enum values
- Changing HTTP status codes

Non-breaking changes:
- Adding new endpoints
- Adding optional fields
- Adding new enum values
- Improving descriptions

## Best Practices

### 1. Document All Endpoints

Every route should have JSDoc annotations:
```typescript
/**
 * @swagger
 * /api/v1/resource:
 *   get:
 *     summary: Brief description
 *     tags: [ResourceTag]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success response
 */
```

### 2. Use Schema References

Define reusable schemas in `src/docs/schemas/common.schema.ts`:
```typescript
export const mySchemas = {
  MyModel: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
    },
  },
};
```

Reference in routes:
```typescript
/**
 * @swagger
 * responses:
 *   200:
 *     content:
 *       application/json:
 *         schema:
 *           $ref: '#/components/schemas/MyModel'
 */
```

### 3. Regenerate on Changes

After modifying routes or schemas:
```bash
npm run generate:types
```

Commit both code changes and `openapi.json` together.

### 4. Version Breaking Changes

If you must make breaking changes:
1. Bump API version (v1 → v2)
2. Keep old version running
3. Deprecate old version gradually
4. Update documentation

### 5. Test Against Spec

Write contract tests that validate responses:
```typescript
it('should match OpenAPI spec', async () => {
  const response = await request(app).get('/api/v1/endpoint');
  
  // Validate against spec schema
  expect(response.body).toMatchSchema(spec.paths['/endpoint'].get.responses['200']);
});
```

## Swagger UI

### Accessing Documentation

Development: http://localhost:5000/api/v1/docs

The Swagger UI provides:
- Interactive API explorer
- Request/response examples
- Authentication testing
- Schema documentation

### Configuration

Swagger UI is configured in `src/config/swagger.ts` and mounted in `src/app.ts`.

For production, consider:
- Disabling Swagger UI (security)
- Serving static `openapi.json` only
- Using external documentation hosting

## Troubleshooting

### Spec Generation Fails

- Check JSDoc syntax in routes
- Ensure all $ref paths are valid
- Validate YAML syntax in annotations

### Types Not Generated

- Run `npm run generate:spec` first
- Check `openapi.json` exists
- Verify `openapi-typescript` is installed

### Breaking Change False Positives

- Review the diff output carefully
- Some changes may be incorrectly flagged
- Override with `--force` if necessary (with caution)

### $ref Resolution Errors

- Ensure schemas are exported in `common.schema.ts`
- Check schema names match $ref paths
- Use inline schemas for complex cases

## Resources

- [OpenAPI 3.0 Specification](https://swagger.io/specification/)
- [swagger-jsdoc Documentation](https://github.com/Surnet/swagger-jsdoc)
- [openapi-typescript](https://github.com/drwpow/openapi-typescript)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
