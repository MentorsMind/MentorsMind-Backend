import {
  commonSchemas,
  authSchemas,
  userSchemas,
  mentorSchemas,
  walletSchemas,
  adminSchemas,
} from '../docs/schemas/common.schema';
import config from './index';

const { port, apiVersion } = config.server;

export const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MentorMinds Stellar API',
      version: '1.0.0',
      description: `
## Overview
Backend API for the MentorMinds platform — connecting mentors and mentees with Stellar blockchain payments.

## Authentication
Most endpoints require a **Bearer JWT token**. Obtain tokens via \`POST /auth/login\` or \`POST /auth/register\`.

Include the token in the \`Authorization\` header:
\`\`\`
Authorization: Bearer <your_access_token>
\`\`\`

Use the **Authorize** button (🔒) above to set your token for all requests.
      `.trim(),
      contact: { name: 'MentorMinds Team', email: 'support@mentorminds.com' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [
      {
        url: `http://localhost:${port}/api/${apiVersion}`,
        description: 'Development server',
      },
      {
        url: `https://api.mentorminds.com/api/${apiVersion}`,
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token obtained from /auth/login',
        },
      },
      schemas: {
        // Common response schemas
        SuccessResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'success' },
            message: { type: 'string' },
            data: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'error' },
            message: { type: 'string' },
            error: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            hasMore: { type: 'boolean' },
          },
        },
        ...commonSchemas,
        ...authSchemas,
        ...userSchemas,
        ...mentorSchemas,
        ...walletSchemas,
        ...adminSchemas,
      },
    },
    tags: [
      { name: 'Health', description: 'Service health and readiness checks' },
      {
        name: 'Auth',
        description:
          'Registration, login, token refresh, and password management',
      },
      { name: 'Users', description: 'User profile management' },
      {
        name: 'Mentors',
        description: 'Mentor profiles and session scheduling',
      },
      { name: 'Payments', description: 'Payment processing and escrow' },
      {
        name: 'Wallets',
        description: 'Stellar wallet linking and transaction verification',
      },
      {
        name: 'Admin',
        description: 'Platform administration (admin role required)',
      },
      { name: 'Bookings', description: 'Session booking and meeting management' },
      { name: 'Notifications', description: 'In-app and push notifications' },
    ],
  },
  apis: ['./src/routes/*.ts', './src/docs/schemas/*.ts'],
};
