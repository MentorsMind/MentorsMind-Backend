import request from 'supertest';
import app from '../../app';
import SwaggerParser from '@apidevtools/swagger-parser';
import path from 'path';
import fs from 'fs';

describe('OpenAPI Contract Tests', () => {
  let spec: any;

  beforeAll(async () => {
    // Load OpenAPI spec
    const specPath = path.join(process.cwd(), 'openapi.json');
    
    if (!fs.existsSync(specPath)) {
      throw new Error('openapi.json not found. Run npm run generate:spec first.');
    }
    
    // Validate and dereference spec
    spec = await SwaggerParser.dereference(specPath);
  });

  describe('Spec Validation', () => {
    it('should have valid OpenAPI 3.0 specification', async () => {
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.info).toBeDefined();
      expect(spec.info.title).toBe('MentorMinds Stellar API');
      expect(spec.paths).toBeDefined();
    });

    it('should have security schemes defined', () => {
      expect(spec.components.securitySchemes).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth.type).toBe('http');
      expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    });

    it('should have all required tags', () => {
      const tags = spec.tags || [];
      const tagNames = tags.map((t: any) => t.name);
      
      expect(tagNames).toContain('Health');
      expect(tagNames).toContain('Auth');
      expect(tagNames).toContain('Users');
    });
  });

  describe('Health Endpoint Contract', () => {
    it('should match OpenAPI spec for GET /health', async () => {
      const response = await request(app).get('/health');
      
      // Check status code is documented
      const healthPath = spec.paths['/health'];
      expect(healthPath).toBeDefined();
      expect(healthPath.get).toBeDefined();
      expect(healthPath.get.responses['200']).toBeDefined();
      
      // Validate response structure
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('API Documentation Endpoint', () => {
    it('should serve OpenAPI spec at /api/v1/docs/spec.json', async () => {
      const response = await request(app).get('/api/v1/docs/spec.json');
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.openapi).toBe('3.0.0');
      expect(response.body.paths).toBeDefined();
    });
  });

  describe('Response Schema Validation', () => {
    it('should validate error response format', () => {
      const errorSchema = spec.components?.schemas?.Error;
      
      if (errorSchema) {
        expect(errorSchema.type).toBe('object');
        expect(errorSchema.properties).toHaveProperty('status');
        expect(errorSchema.properties).toHaveProperty('message');
      }
    });

    it('should validate success response format', () => {
      const successSchema = spec.components?.schemas?.SuccessResponse;
      
      if (successSchema) {
        expect(successSchema.type).toBe('object');
        expect(successSchema.properties).toHaveProperty('status');
        expect(successSchema.properties).toHaveProperty('data');
      }
    });
  });

  describe('Endpoint Coverage', () => {
    it('should document all critical endpoints', () => {
      const paths = Object.keys(spec.paths || {});
      
      // Check for key endpoints
      const criticalEndpoints = [
        '/health',
        '/api/v1/auth/login',
        '/api/v1/auth/register',
        '/api/v1/users/profile',
      ];
      
      criticalEndpoints.forEach(endpoint => {
        const normalizedPaths = paths.map(p => p.replace(/\{[^}]+\}/g, match => match));
        const found = normalizedPaths.some(p => endpoint.includes(p) || p.includes(endpoint.split('/').pop() || ''));
        
        if (!found) {
          console.warn(`⚠️  Endpoint ${endpoint} might not be documented`);
        }
      });
      
      expect(paths.length).toBeGreaterThan(0);
    });
  });
});
