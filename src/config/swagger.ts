export const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'MentorMinds Stellar API',
    version: '1.0.0',
    description: 'Backend API for MentorMinds platform - connecting mentors and mentees with Stellar blockchain integration',
    contact: {
      name: 'MentorMinds Team',
      email: 'support@mentorminds.com',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: `http://localhost:${process.env.PORT || 5000}/api/${process.env.API_VERSION || 'v1'}`,
      description: 'Development server',
    },
    {
      url: `https://api.mentorminds.com/api/${process.env.API_VERSION || 'v1'}`,
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['success', 'error', 'fail'],
          },
          message: {
            type: 'string',
          },
          data: {
            type: 'object',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['error', 'fail'],
          },
          message: {
            type: 'string',
          },
          error: {
            type: 'string',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
    },
  },
  tags: [
    { name: 'Health', description: 'Health check endpoints' },
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Users', description: 'User management endpoints' },
    { name: 'Mentors', description: 'Mentor management endpoints' },
    { name: 'Bookings', description: 'Booking management endpoints' },
    { name: 'Payments', description: 'Payment processing endpoints' },
    { name: 'Wallets', description: 'Stellar wallet endpoints' },
  ],
};

export const swaggerOptions = {
  swaggerDefinition,
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'],
};
