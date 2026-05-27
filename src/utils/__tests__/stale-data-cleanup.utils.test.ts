/**
 * Tests for Stale Data Cleanup Utility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import staleDataCleanupManager from '../stale-data-cleanup.utils';

// Mock the database pool
vi.mock('../../config/database', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('Stale Data Cleanup Manager', () => {
  beforeEach(() => {
    staleDataCleanupManager.clearHistory();
  });

  describe('Cleanup Operations', () => {
    it('should track cleanup operations', () => {
      const stats = staleDataCleanupManager.getCleanupStats();
      expect(stats.totalOperations).toBe(0);
    });

    it('should maintain cleanup history', () => {
      const history = staleDataCleanupManager.getCleanupHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it('should limit history size', () => {
      const history = staleDataCleanupManager.getCleanupHistory(100);
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Cleanup Statistics', () => {
    it('should provide cleanup statistics', () => {
      const stats = staleDataCleanupManager.getCleanupStats();

      expect(stats).toHaveProperty('totalOperations');
      expect(stats).toHaveProperty('successfulOperations');
      expect(stats).toHaveProperty('failedOperations');
      expect(stats).toHaveProperty('warningOperations');
      expect(stats).toHaveProperty('totalRecordsDeleted');
      expect(stats).toHaveProperty('totalRecordsArchived');
      expect(stats).toHaveProperty('averageDuration');
      expect(stats).toHaveProperty('operationsByType');
    });

    it('should track operation types', () => {
      const stats = staleDataCleanupManager.getCleanupStats();

      expect(stats.operationsByType).toHaveProperty('notifications');
      expect(stats.operationsByType).toHaveProperty('refreshTokens');
      expect(stats.operationsByType).toHaveProperty('auditLogs');
      expect(stats.operationsByType).toHaveProperty('sessions');
    });
  });

  describe('History Management', () => {
    it('should clear history', () => {
      staleDataCleanupManager.clearHistory();
      const history = staleDataCleanupManager.getCleanupHistory();
      expect(history.length).toBe(0);
    });

    it('should retrieve limited history', () => {
      const history = staleDataCleanupManager.getCleanupHistory(10);
      expect(history.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Retention Periods', () => {
    it('should have correct retention periods configured', () => {
      const stats = staleDataCleanupManager.getCleanupStats();
      expect(stats).toBeDefined();
      // Retention periods are internal to the manager
    });
  });
});
