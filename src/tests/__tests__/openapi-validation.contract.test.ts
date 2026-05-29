/**
 * Contract tests validating API responses against OpenAPI spec
 */

import request from 'supertest';
import app from '../../app';
import fs from 'fs';
import path from 'path';

describe('OpenAPI Contract Validation', () => {
  let spec: any;

  beforeAll(() => {
    // Load OpenAPI spec
    const specPath = path.join(process.cwd(), 'openapi.json');
    
    if (fs.existsSync(specPath)) {
      spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    } else {
      console.warn('⚠️  openapi.json not found. Run npm run generate:spec');
    }
  });

  describe('Spec Structure', () => {
    it('should have valid OpenAPI 3.0 structure', () => {
      if (!spec) {
        console.warn('Skipping: spec not loaded');
        return;
      }
      
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe('MentorMinds Stellar API');
      expect(spec.info.version).toBeDefined();
      expect(spec.paths).toBeDefined();
      expect(spec.components).toBeDefined();
    });

    it('should have security schemes defined', () => {
      if (!spec) return;
      
      expect(spec.components.securitySchemes).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth.type).toBe('http');
      expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    });

    it('should have common response schemas', () => {
      if (!spec) return;
      
      const schemas = spec.components.schemas || {};
      expect(schemas.SuccessResponse).toBeDefined();
      expect(schemas.ErrorResponse).toBeDefined();
      expect(schemas.PaginationMeta).toBeDefined();
    });
  });

  describe('Health Endpoint', () => {
    it('should return response matching spec structure', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('checks');
      
      // Validate checks structure
      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks).toHaveProperty('redis');
      expect(response.body.checks).toHaveProperty('stellar');
    });
  });

  describe('API Documentation', () => {
    it('should serve OpenAPI spec at /api/v1/docs/spec.json', async () => {
      const response = await request(app).get('/api/v1/docs/spec.json');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.openapi).toBe('3.0.0');
      expect(response.body.paths).toBeDefined();
      expect(Object.keys(response.body.paths).length).toBeGreaterThan(0);
    });

    it('should serve Swagger UI at /api/v1/docs', async () => {
      const response = await request(app).get('/api/v1/docs/');
      
      expect(response.status).toBe(200);
      expect(response.text).toContain('swagger-ui');
    });
  });

  describe('Response Format Validation', () => {
    it('should return consistent error format for 404', async () => {
      const response = await request(app).get('/api/v1/nonexistent');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('error');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return consistent success format', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('success');
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('Endpoint Coverage', () => {
    it('should document critical endpoints', () => {
      if (!spec) return;
      
      const paths = Object.keys(spec.paths || {});
      
      // Check for documented endpoints
      expect(paths.length).toBeGreaterThan(50);
      
      // Log endpoint count by tag
      const endpointsByTag: Record<string, number> = {};
      Object.values(spec.paths || {}).forEach((pathItem: any) => {
        Object.values(pathItem).forEach((operation: any) => {
          if (operation.tags) {
            operation.tags.forEach((tag: string) => {
              endpointsByTag[tag] = (endpointsByTag[tag] || 0) + 1;
            });
          }
        });
      });
      
      console.log('📊 Endpoints by tag:', endpointsByTag);
    });
  });
});
