# API Routes Structure

This directory contains all API route definitions for the MentorMinds platform.

## Route Organization

- `index.ts` - Main router that mounts all route modules
- `auth.routes.ts` - Authentication and authorization routes
- Additional route modules to be added:
  - `users.routes.ts` - User management
  - `mentors.routes.ts` - Mentor profiles and management
  - `bookings.routes.ts` - Session booking management
  - `payments.routes.ts` - Payment processing
  - `wallets.routes.ts` - Stellar wallet operations

## Usage Example

```typescript
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { ResponseUtil } from '../utils/response.utils';
import { mySchema } from '../schemas/my.schemas';

const router = Router();

// Public route
router.get('/public', asyncHandler(async (req, res) => {
  ResponseUtil.success(res, { data: 'public' });
}));

// Protected route
router.get('/protected', authenticate, asyncHandler(async (req, res) => {
  ResponseUtil.success(res, { data: 'protected' });
}));

// Role-based route
router.post('/admin', authenticate, authorize('admin'), validate(mySchema), asyncHandler(async (req, res) => {
  ResponseUtil.created(res, { data: 'created' });
}));

export default router;
```
