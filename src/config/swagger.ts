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
      // Selecting this server makes the Swagger UI "Try it out" button call
      // the fixture-data sandbox instead of real endpoints (issue #784).
      // Only offered when SANDBOX_MODE=true.
      ...(process.env.SANDBOX_MODE === 'true'
        ? [
          {
            url: `http://localhost:${port}/api/${apiVersion}/sandbox`,
            description: 'Sandbox (Try it out) — fixture data, no real side effects',
          },
        ]
        : []),
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
      { name: 'Session Quality', description: 'ML-based session quality analytics and scoring' },
      { name: 'Feedback', description: 'Session feedback submission and retrieval' },
      { name: 'Analytics', description: 'Platform and learning analytics' },
      { name: 'Documentation', description: 'API documentation portal and guides' },
      {
        name: 'GraphQL',
        description:
          'GraphQL endpoint (POST /api/graphql) — query/mutation execution with bearer auth',
      },
    ],
  },
  apis: [
    './src/routes/*.ts',
    './src/routes/v1/*.ts',
    './src/routes/admin/*.ts',
    './src/docs/schemas/*.ts',
    // GraphQL endpoint declaration (@swagger annotation for POST /api/graphql)
    './src/app.ts',
    './src/graphql/server.ts',
  ],
};
