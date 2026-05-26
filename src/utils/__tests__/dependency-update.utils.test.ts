/**
 * Tests for Dependency Update Utility
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import dependencyUpdateManager from '../dependency-update.utils';

describe('Dependency Update Manager', () => {
  beforeEach(() => {
    dependencyUpdateManager.clearHistory();
  });

  describe('Update Recording', () => {
    it('should record dependency updates', () => {
      const update = dependencyUpdateManager.recordUpdate(
        'express',
        '4.17.1',
        '4.18.0',
        'production',
        false,
        []
      );

      expect(update.name).toBe('express');
      expect(update.oldVersion).toBe('4.17.1');
      expect(update.newVersion).toBe('4.18.0');
      expect(update.status).toBe('pending');
    });

    it('should determine update type correctly', () => {
      const patch = dependencyUpdateManager.recordUpdate(
        'pkg1',
        '1.0.0',
        '1.0.1',
        'production'
      );
      expect(patch.updateType).toBe('patch');

      const minor = dependencyUpdateManager.recordUpdate(
        'pkg2',
        '1.0.0',
        '1.1.0',
        'production'
      );
      expect(minor.updateType).toBe('minor');

      const major = dependencyUpdateManager.recordUpdate(
        'pkg3',
        '1.0.0',
        '2.0.0',
        'production'
      );
      expect(major.updateType).toBe('major');
    });

    it('should track security updates', () => {
      dependencyUpdateManager.recordUpdate(
        'lodash',
        '4.17.20',
        '4.17.21',
        'production',
        true
      );

      const securityUpdates = dependencyUpdateManager.getSecurityUpdates();
      expect(securityUpdates.length).toBe(1);
      expect(securityUpdates[0].security).toBe(true);
    });
  });

  describe('Update Status', () => {
    it('should mark update as tested', () => {
      dependencyUpdateManager.recordUpdate(
        'express',
        '4.17.1',
        '4.18.0',
        'production'
      );

      dependencyUpdateManager.markAsTested('express', '4.18.0');

      const history = dependencyUpdateManager.getUpdateHistory();
      const update = history.find((u) => u.name === 'express');
      expect(update?.status).toBe('tested');
    });

    it('should mark update as deployed', () => {
      dependencyUpdateManager.recordUpdate(
        'express',
        '4.17.1',
        '4.18.0',
        'production'
      );

      dependencyUpdateManager.markAsDeployed('express', '4.18.0');

      const history = dependencyUpdateManager.getUpdateHistory();
      const update = history.find((u) => u.name === 'express');
      expect(update?.status).toBe('deployed');
    });

    it('should mark update as failed', () => {
      dependencyUpdateManager.recordUpdate(
        'express',
        '4.17.1',
        '4.18.0',
        'production'
      );

      dependencyUpdateManager.markAsFailed('express', '4.18.0', 'Test failed');

      const history = dependencyUpdateManager.getUpdateHistory();
      const update = history.find((u) => u.name === 'express');
      expect(update?.status).toBe('failed');
    });
  });

  describe('Update Filtering', () => {
    beforeEach(() => {
      dependencyUpdateManager.recordUpdate('pkg1', '1.0.0', '1.0.1', 'production');
      dependencyUpdateManager.recordUpdate('pkg2', '1.0.0', '1.1.0', 'production');
      dependencyUpdateManager.recordUpdate('pkg3', '1.0.0', '2.0.0', 'production');
      dependencyUpdateManager.recordUpdate('pkg4', '1.0.0', '1.0.1', 'development', true);
    });

    it('should filter updates by type', () => {
      const patches = dependencyUpdateManager.getUpdatesByType('patch');
      const minors = dependencyUpdateManager.getUpdatesByType('minor');
      const majors = dependencyUpdateManager.getUpdatesByType('major');

      expect(patches.length).toBe(2);
      expect(minors.length).toBe(1);
      expect(majors.length).toBe(1);
    });

    it('should get security updates', () => {
      const security = dependencyUpdateManager.getSecurityUpdates();
      expect(security.length).toBe(1);
      expect(security[0].name).toBe('pkg4');
    });

    it('should get breaking changes', () => {
      dependencyUpdateManager.recordUpdate(
        'pkg5',
        '1.0.0',
        '2.0.0',
        'production',
        false,
        ['API changed', 'Config format changed']
      );

      const breaking = dependencyUpdateManager.getBreakingChanges();
      expect(breaking.length).toBeGreaterThan(0);
    });
  });

  describe('Statistics', () => {
    it('should provide update statistics', () => {
      dependencyUpdateManager.recordUpdate('pkg1', '1.0.0', '1.0.1', 'production');
      dependencyUpdateManager.recordUpdate('pkg2', '1.0.0', '1.1.0', 'production');

      const stats = dependencyUpdateManager.getUpdateStats();

      expect(stats.total).toBe(2);
      expect(stats.byType.patch).toBe(1);
      expect(stats.byType.minor).toBe(1);
      expect(stats.byStatus.pending).toBe(2);
    });
  });

  describe('History Management', () => {
    it('should maintain update history', () => {
      dependencyUpdateManager.recordUpdate('pkg1', '1.0.0', '1.0.1', 'production');
      dependencyUpdateManager.recordUpdate('pkg2', '1.0.0', '1.1.0', 'production');

      const history = dependencyUpdateManager.getUpdateHistory();
      expect(history.length).toBe(2);
    });

    it('should clear history', () => {
      dependencyUpdateManager.recordUpdate('pkg1', '1.0.0', '1.0.1', 'production');
      dependencyUpdateManager.clearHistory();

      const history = dependencyUpdateManager.getUpdateHistory();
      expect(history.length).toBe(0);
    });
  });
});
