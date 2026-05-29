#!/usr/bin/env node

/**
 * Generate OpenAPI 3.0 specification from JSDoc annotations
 * Outputs to openapi.json at project root
 */

const swaggerJsdoc = require('swagger-jsdoc');
const fs = require('fs');
const path = require('path');

// Load swagger options from config
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MentorMinds Stellar API',
      version: '1.0.0',
      description: 'Backend API for the MentorMinds platform — connecting mentors and mentees with Stellar blockchain payments.',
      contact: { name: 'MentorMinds Team', email: 'support@mentorminds.com' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [
      {
        url: 'http://localhost:5000/api/v1',
        description: 'Development server',
      },
      {
        url: 'https://api.mentorminds.com/api/v1',
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
    },
  },
  apis: ['./src/routes/*.ts', './src/docs/schemas/*.ts'],
};

try {
  console.log('🔄 Generating OpenAPI specification...');
  
  const spec = swaggerJsdoc(swaggerOptions);
  
  // Write to openapi.json
  const outputPath = path.join(process.cwd(), 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  
  console.log(`✅ OpenAPI spec generated: ${outputPath}`);
  console.log(`📊 Endpoints: ${Object.keys(spec.paths || {}).length}`);
  console.log(`📦 Schemas: ${Object.keys(spec.components?.schemas || {}).length}`);
} catch (error) {
  console.error('❌ Failed to generate OpenAPI spec:', error);
  process.exit(1);
}
