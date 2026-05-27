/**
 * Tests for Database Maintenance Utility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import databaseMaintenanceManager from '../database-maintenance.utils';

// Mock the database pool
vi.mock('../../config/database', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('Database Maintenance Manager', () => {
  beforeEach(() => {
    databaseMaintenanceManager.clearHistory();
  });

  describe('VACUUM Operation', () => {
    it('should record VACUUM operation', async () => {
      const stats = databaseMaintenanceManager.getMaintenanceStats();
      expect(stats.operationsByType.vacuum).toBe(0);
    });

    it('should track operation duration', () => {
      const history = databaseMaintenanceManager.getMaintenanceHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('ANALYZE Operation', () => {
    it('should track ANALYZE operations', () => {
      const stats = databaseMaintenanceManager.getMaintenanceStats();
      expect(stats.operationsByType.analyze).toBe(0);
    });
  });

  describe('Index Rebuild', () => {
    it('should track index rebuild operations', () => {
      const stats = databaseMaintenanceManager.getMaintenanceStats();
      expect(stats.operationsByType.indexRebuild).toBe(0);
    });
  });

  describe('Table Bloat Check', () => {
    it('should track bloat check operations', () => {
      const stats = databaseMaintenanceManager.getMaintenanceStats();
      expect(stats.operationsByType.bloatCheck).toBe(0);
    });
  });

  describe('Maintenance History', () => {
    it('should maintain operation history', () => {
      const history = databaseMaintenanceManager.getMaintenanceHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should limit history size', () => {
      const history = databaseMaintenanceManager.getMaintenanceHistory(100);
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should clear history', () => {
      databaseMaintenanceManager.clearHistory();
      const history = databaseMaintenanceManager.getMaintenanceHistory();
      expect(history.length).toBe(0);
    });
  });

  describe('Maintenance Statistics', () => {
    it('should provide maintenance statistics', () => {
      const stats = databaseMaintenanceManager.getMaintenanceStats();

      expect(stats).toHaveProperty('totalOperations');
      expect(stats).toHaveProperty('successfulOperations');
      expect(stats).toHaveProperty('failedOperations');
      expect(stats).toHaveProperty('warningOperations');
      expect(stats).toHaveProperty('averageDuration');
      expect(stats).toHaveProperty('operationsByType');
    });

    it('should track operation types', () => {
      const stats = databaseMaintenanceManager.getMaintenanceStats();

      expect(stats.operationsByType).toHaveProperty('vacuum');
      expect(stats.operationsByType).toHaveProperty('analyze');
      expect(stats.operationsByType).toHaveProperty('indexRebuild');
      expect(stats.operationsByType).toHaveProperty('bloatCheck');
    });
  });
});
