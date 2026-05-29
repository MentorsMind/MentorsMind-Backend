# @mentorminds/api-types

TypeScript types for the MentorMinds API, generated from the OpenAPI 3.0 specification.

## Installation

```bash
npm install @mentorminds/api-types
```

## Usage

```typescript
import {
  User,
  LoginRequest,
  AuthTokens,
  ApiResponse,
  PaginatedResponse,
} from '@mentorminds/api-types';

// Type-safe API request
const loginData: LoginRequest = {
  email: 'user@example.com',
  password: 'password123',
};

// Type-safe API response
const response: ApiResponse<{ user: User; tokens: AuthTokens }> = await fetch(
  '/api/v1/auth/login',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginData),
  }
).then(r => r.json());

// Type-safe paginated response
const users: PaginatedResponse<{ users: User[] }> = await fetch(
  '/api/v1/users?page=1&limit=10'
).then(r => r.json());
```

## Available Types

### Authentication
- `RegisterRequest`
- `LoginRequest`
- `AuthTokens`
- `RefreshTokenRequest`

### Users
- `User`
- `PublicUser`
- `UpdateUserRequest`

### Mentors
- `MentorProfile`

### Sessions/Bookings
- `Session`
- `CreateSessionRequest`

### Notifications
- `Notification`
- `PushSubscribeRequest`
- `PushToken`

### Common
- `ApiResponse<T>`
- `PaginatedResponse<T>`
- `PaginationMeta`
- `HealthStatus`

## Regenerating Types

Types are automatically generated from the OpenAPI spec:

```bash
# In the backend repository
npm run generate:types
```

This will:
1. Generate `openapi.json` from JSDoc annotations
2. Generate TypeScript types in `packages/api-types/src/index.ts`

## Sharing with Frontend

### Option 1: npm Package (Recommended)

Publish to npm registry:
```bash
cd packages/api-types
npm publish
```

Then install in frontend:
```bash
npm install @mentorminds/api-types
```

### Option 2: Local Package

Use npm workspaces or link:
```bash
# In frontend project
npm link ../backend/packages/api-types
```

### Option 3: Copy Files

Copy `packages/api-types/src/index.ts` to your frontend project.

## Contract Testing

The types ensure type safety between frontend and backend. Breaking changes in the API will cause TypeScript compilation errors in the frontend, catching issues before deployment.
