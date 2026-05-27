/**
 * Tests for Deprecation Utility
 */

import { describe, it, expect, beforeEach } from 'vitest';
import deprecationManager, { createDeprecationConfig } from '../deprecation.utils';

describe('Deprecation Manager', () => {
  beforeEach(() => {
    deprecationManager.clearAll();
  });

  describe('Registration', () => {
    it('should register a deprecated endpoint', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        replacementEndpoint: 'GET /api/v2/users/:id',
      });

      deprecationManager.registerDeprecation(config);

      expect(deprecationManager.isDeprecated('GET /api/v1/users/:id')).toBe(true);
    });

    it('should throw error if sunset date is less than 6 months away', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        sunsetMonths: 3,
      });

      expect(() => deprecationManager.registerDeprecation(config)).toThrow();
    });

    it('should allow sunset date exactly 6 months away', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        sunsetMonths: 6,
      });

      expect(() => deprecationManager.registerDeprecation(config)).not.toThrow();
    });

    it('should allow sunset date more than 6 months away', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        sunsetMonths: 12,
      });

      expect(() => deprecationManager.registerDeprecation(config)).not.toThrow();
    });
  });

  describe('Retrieval', () => {
    beforeEach(() => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        replacementEndpoint: 'GET /api/v2/users/:id',
        migrationGuide: 'https://docs.example.com/migration',
      });
      deprecationManager.registerDeprecation(config);
    });

    it('should retrieve deprecation config', () => {
      const config = deprecationManager.getDeprecation('GET /api/v1/users/:id');
      expect(config).toBeDefined();
      expect(config?.replacementEndpoint).toBe('GET /api/v2/users/:id');
    });

    it('should return undefined for non-deprecated endpoint', () => {
      const config = deprecationManager.getDeprecation('GET /api/v1/posts/:id');
      expect(config).toBeUndefined();
    });

    it('should check if endpoint is deprecated', () => {
      expect(deprecationManager.isDeprecated('GET /api/v1/users/:id')).toBe(true);
      expect(deprecationManager.isDeprecated('GET /api/v1/posts/:id')).toBe(false);
    });
  });

  describe('Sunset Checking', () => {
    it('should return false for endpoint not yet sunset', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        sunsetMonths: 6,
      });
      deprecationManager.registerDeprecation(config);

      expect(deprecationManager.shouldBeRemoved('GET /api/v1/users/:id')).toBe(false);
    });

    it('should return true for endpoint past sunset date', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        sunsetMonths: 6,
      });
      config.sunsetDate = new Date(Date.now() - 1000); // 1 second in the past
      deprecationManager.registerDeprecation(config);

      expect(deprecationManager.shouldBeRemoved('GET /api/v1/users/:id')).toBe(true);
    });
  });

  describe('Status Reporting', () => {
    beforeEach(() => {
      // Register multiple endpoints
      const config1 = createDeprecationConfig('GET /api/v1/users/:id', {
        replacementEndpoint: 'GET /api/v2/users/:id',
        sunsetMonths: 6,
      });
      deprecationManager.registerDeprecation(config1);

      const config2 = createDeprecationConfig('POST /api/v1/bookings', {
        replacementEndpoint: 'POST /api/v2/bookings',
        sunsetMonths: 6,
      });
      deprecationManager.registerDeprecation(config2);
    });

    it('should return status for all deprecated endpoints', () => {
      const status = deprecationManager.getDeprecationStatus();
      expect(status).toHaveLength(2);
    });

    it('should include endpoint, status, and days until sunset', () => {
      const status = deprecationManager.getDeprecationStatus();
      const userStatus = status.find((s) => s.endpoint === 'GET /api/v1/users/:id');

      expect(userStatus).toBeDefined();
      expect(userStatus?.status).toBe('deprecated');
      expect(userStatus?.daysUntilSunset).toBeGreaterThan(0);
      expect(userStatus?.replacementEndpoint).toBe('GET /api/v2/users/:id');
    });

    it('should mark endpoint as sunset when date passed', () => {
      const config = createDeprecationConfig('GET /api/v1/posts/:id', {
        sunsetMonths: 6,
      });
      config.sunsetDate = new Date(Date.now() - 1000);
      deprecationManager.registerDeprecation(config);

      const status = deprecationManager.getDeprecationStatus();
      const postStatus = status.find((s) => s.endpoint === 'GET /api/v1/posts/:id');

      expect(postStatus?.status).toBe('sunset');
      expect(postStatus?.daysUntilSunset).toBeUndefined();
    });
  });

  describe('Removal', () => {
    beforeEach(() => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        sunsetMonths: 6,
      });
      deprecationManager.registerDeprecation(config);
    });

    it('should remove a deprecation', () => {
      expect(deprecationManager.isDeprecated('GET /api/v1/users/:id')).toBe(true);

      deprecationManager.removeDeprecation('GET /api/v1/users/:id');

      expect(deprecationManager.isDeprecated('GET /api/v1/users/:id')).toBe(false);
    });

    it('should clear all deprecations', () => {
      const config = createDeprecationConfig('POST /api/v1/bookings', {
        sunsetMonths: 6,
      });
      deprecationManager.registerDeprecation(config);

      expect(deprecationManager.getDeprecationStatus()).toHaveLength(2);

      deprecationManager.clearAll();

      expect(deprecationManager.getDeprecationStatus()).toHaveLength(0);
    });
  });

  describe('Helper Functions', () => {
    it('should create deprecation config with defaults', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id');

      expect(config.endpoint).toBe('GET /api/v1/users/:id');
      expect(config.deprecatedDate).toBeDefined();
      expect(config.sunsetDate).toBeDefined();
      expect(config.sunsetDate.getTime()).toBeGreaterThan(config.deprecatedDate.getTime());
    });

    it('should create deprecation config with custom options', () => {
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        replacementEndpoint: 'GET /api/v2/users/:id',
        migrationGuide: 'https://docs.example.com/migration',
        reason: 'Performance improvement',
        sunsetMonths: 12,
      });

      expect(config.replacementEndpoint).toBe('GET /api/v2/users/:id');
      expect(config.migrationGuide).toBe('https://docs.example.com/migration');
      expect(config.reason).toBe('Performance improvement');
    });

    it('should calculate sunset date correctly', () => {
      const now = new Date();
      const config = createDeprecationConfig('GET /api/v1/users/:id', {
        sunsetMonths: 6,
      });

      const expectedSunsetMonth = (now.getMonth() + 6) % 12;
      expect(config.sunsetDate.getMonth()).toBe(expectedSunsetMonth);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple registrations of same endpoint', () => {
      const config1 = createDeprecationConfig('GET /api/v1/users/:id', {
        replacementEndpoint: 'GET /api/v2/users/:id',
      });
      deprecationManager.registerDeprecation(config1);

      const config2 = createDeprecationConfig('GET /api/v1/users/:id', {
        replacementEndpoint: 'GET /api/v3/users/:id',
      });
      deprecationManager.registerDeprecation(config2);

      const config = deprecationManager.getDeprecation('GET /api/v1/users/:id');
      expect(config?.replacementEndpoint).toBe('GET /api/v3/users/:id');
    });

    it('should handle endpoints with special characters', () => {
      const config = createDeprecationConfig('DELETE /api/v1/users/:id/sessions/:sessionId', {
        sunsetMonths: 6,
      });
      deprecationManager.registerDeprecation(config);

      expect(deprecationManager.isDeprecated('DELETE /api/v1/users/:id/sessions/:sessionId')).toBe(
        true
      );
    });

    it('should handle empty registry', () => {
      const status = deprecationManager.getDeprecationStatus();
      expect(status).toHaveLength(0);
    });
  });
});
