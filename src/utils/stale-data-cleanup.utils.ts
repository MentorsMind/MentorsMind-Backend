/**
 * Stale Data Cleanup Utility
 * 
 * Handles automatic cleanup of stale and expired data:
 * - Delete old notifications (>90 days)
 * - Delete expired refresh tokens
 * - Delete old audit logs (keep 7 years)
 * - Archive old sessions (>2 years)
 */

import pool from '../config/database';
import { logInfo, logWarning, logError } from './error.utils';

export interface CleanupStats {
  timestamp: Date;
  operation: 'notifications' | 'refresh_tokens' | 'audit_logs' | 'sessions' | 'full_cleanup';
  status: 'success' | 'failed' | 'warning';
  recordsDeleted: number;
  recordsArchived: number;
  duration: number; // milliseconds
  details: Record<string, any>;
  message: string;
}

class StaleDataCleanupManager {
  private cleanupHistory: CleanupStats[] = [];
  private readonly MAX_HISTORY = 100;

  // Retention periods
  private readonly NOTIFICATION_RETENTION_DAYS = 90;
  private readonly AUDIT_LOG_RETENTION_YEARS = 7;
  private readonly SESSION_ARCHIVE_YEARS = 2;

  /**
   * Delete old notifications (older than 90 days)
   */
  async deleteOldNotifications(): Promise<CleanupStats> {
    const startTime = Date.now();
    const operation = 'notifications';

    try {
      logInfo('Starting cleanup of old notifications', {
        retentionDays: this.NOTIFICATION_RETENTION_DAYS,
      });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.NOTIFICATION_RETENTION_DAYS);

      const query = `
        DELETE FROM notifications
        WHERE created_at < $1
        RETURNING id;
      `;

      const result = await pool.query(query, [cutoffDate]);
      const recordsDeleted = result.rowCount || 0;

      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'success',
        recordsDeleted,
        recordsArchived: 0,
        duration,
        details: {
          cutoffDate: cutoffDate.toISOString(),
          retentionDays: this.NOTIFICATION_RETENTION_DAYS,
        },
        message: `Deleted ${recordsDeleted} old notifications in ${duration}ms`,
      };

      this.recordStats(stats);
      logInfo('Old notifications cleanup completed', {
        recordsDeleted,
        duration,
      });

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        recordsDeleted: 0,
        recordsArchived: 0,
        duration,
        details: {
          error: (error as Error).message,
        },
        message: `Failed to delete old notifications: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'delete_old_notifications',
      });

      throw error;
    }
  }

  /**
   * Delete expired refresh tokens
   */
  async deleteExpiredRefreshTokens(): Promise<CleanupStats> {
    const startTime = Date.now();
    const operation = 'refresh_tokens';

    try {
      logInfo('Starting cleanup of expired refresh tokens');

      const now = new Date();

      const query = `
        DELETE FROM refresh_tokens
        WHERE expires_at < $1
        RETURNING id;
      `;

      const result = await pool.query(query, [now]);
      const recordsDeleted = result.rowCount || 0;

      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'success',
        recordsDeleted,
        recordsArchived: 0,
        duration,
        details: {
          currentTime: now.toISOString(),
        },
        message: `Deleted ${recordsDeleted} expired refresh tokens in ${duration}ms`,
      };

      this.recordStats(stats);
      logInfo('Expired refresh tokens cleanup completed', {
        recordsDeleted,
        duration,
      });

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        recordsDeleted: 0,
        recordsArchived: 0,
        duration,
        details: {
          error: (error as Error).message,
        },
        message: `Failed to delete expired refresh tokens: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'delete_expired_refresh_tokens',
      });

      throw error;
    }
  }

  /**
   * Delete old audit logs (keep 7 years)
   */
  async deleteOldAuditLogs(): Promise<CleanupStats> {
    const startTime = Date.now();
    const operation = 'audit_logs';

    try {
      logInfo('Starting cleanup of old audit logs', {
        retentionYears: this.AUDIT_LOG_RETENTION_YEARS,
      });

      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - this.AUDIT_LOG_RETENTION_YEARS);

      const query = `
        DELETE FROM audit_logs
        WHERE created_at < $1
        RETURNING id;
      `;

      const result = await pool.query(query, [cutoffDate]);
      const recordsDeleted = result.rowCount || 0;

      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'success',
        recordsDeleted,
        recordsArchived: 0,
        duration,
        details: {
          cutoffDate: cutoffDate.toISOString(),
          retentionYears: this.AUDIT_LOG_RETENTION_YEARS,
        },
        message: `Deleted ${recordsDeleted} old audit logs in ${duration}ms`,
      };

      this.recordStats(stats);
      logInfo('Old audit logs cleanup completed', {
        recordsDeleted,
        duration,
      });

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        recordsDeleted: 0,
        recordsArchived: 0,
        duration,
        details: {
          error: (error as Error).message,
        },
        message: `Failed to delete old audit logs: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'delete_old_audit_logs',
      });

      throw error;
    }
  }

  /**
   * Archive old sessions (after 2 years)
   */
  async archiveOldSessions(): Promise<CleanupStats> {
    const startTime = Date.now();
    const operation = 'sessions';

    try {
      logInfo('Starting archival of old sessions', {
        archiveYears: this.SESSION_ARCHIVE_YEARS,
      });

      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - this.SESSION_ARCHIVE_YEARS);

      // First, copy old sessions to archive table
      const archiveQuery = `
        INSERT INTO sessions_archive
        SELECT * FROM user_sessions
        WHERE created_at < $1
        ON CONFLICT DO NOTHING
        RETURNING id;
      `;

      const archiveResult = await pool.query(archiveQuery, [cutoffDate]);
      const recordsArchived = archiveResult.rowCount || 0;

      // Then delete from main table
      const deleteQuery = `
        DELETE FROM user_sessions
        WHERE created_at < $1
        RETURNING id;
      `;

      const deleteResult = await pool.query(deleteQuery, [cutoffDate]);
      const recordsDeleted = deleteResult.rowCount || 0;

      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'success',
        recordsDeleted,
        recordsArchived,
        duration,
        details: {
          cutoffDate: cutoffDate.toISOString(),
          archiveYears: this.SESSION_ARCHIVE_YEARS,
        },
        message: `Archived ${recordsArchived} and deleted ${recordsDeleted} old sessions in ${duration}ms`,
      };

      this.recordStats(stats);
      logInfo('Old sessions archival completed', {
        recordsArchived,
        recordsDeleted,
        duration,
      });

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: CleanupStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        recordsDeleted: 0,
        recordsArchived: 0,
        duration,
        details: {
          error: (error as Error).message,
        },
        message: `Failed to archive old sessions: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'archive_old_sessions',
      });

      throw error;
    }
  }

  /**
   * Run full cleanup cycle
   */
  async runFullCleanupCycle(): Promise<CleanupStats[]> {
    const results: CleanupStats[] = [];

    try {
      logInfo('Starting full stale data cleanup cycle', {
        timestamp: new Date().toISOString(),
      });

      // Delete old notifications
      try {
        results.push(await this.deleteOldNotifications());
      } catch (error) {
        logWarning('Notification cleanup failed, continuing with other operations', {
          error: (error as Error).message,
        });
      }

      // Delete expired refresh tokens
      try {
        results.push(await this.deleteExpiredRefreshTokens());
      } catch (error) {
        logWarning('Refresh token cleanup failed, continuing with other operations', {
          error: (error as Error).message,
        });
      }

      // Delete old audit logs
      try {
        results.push(await this.deleteOldAuditLogs());
      } catch (error) {
        logWarning('Audit log cleanup failed, continuing with other operations', {
          error: (error as Error).message,
        });
      }

      // Archive old sessions
      try {
        results.push(await this.archiveOldSessions());
      } catch (error) {
        logWarning('Session archival failed, continuing with other operations', {
          error: (error as Error).message,
        });
      }

      const totalRecordsDeleted = results.reduce((sum, r) => sum + r.recordsDeleted, 0);
      const totalRecordsArchived = results.reduce((sum, r) => sum + r.recordsArchived, 0);
      const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

      logInfo('Full cleanup cycle completed', {
        operations: results.length,
        totalRecordsDeleted,
        totalRecordsArchived,
        totalDuration,
      });

      return results;
    } catch (error) {
      logError(error as Error, 'critical', {
        operation: 'full_cleanup_cycle',
      });
      throw error;
    }
  }

  /**
   * Record cleanup statistics
   */
  private recordStats(stats: CleanupStats): void {
    this.cleanupHistory.push(stats);

    // Keep only recent history
    if (this.cleanupHistory.length > this.MAX_HISTORY) {
      this.cleanupHistory = this.cleanupHistory.slice(-this.MAX_HISTORY);
    }
  }

  /**
   * Get cleanup history
   */
  getCleanupHistory(limit: number = 50): CleanupStats[] {
    return this.cleanupHistory.slice(-limit);
  }

  /**
   * Get cleanup statistics
   */
  getCleanupStats() {
    const history = this.cleanupHistory;

    return {
      totalOperations: history.length,
      successfulOperations: history.filter((s) => s.status === 'success').length,
      failedOperations: history.filter((s) => s.status === 'failed').length,
      warningOperations: history.filter((s) => s.status === 'warning').length,
      totalRecordsDeleted: history.reduce((sum, s) => sum + s.recordsDeleted, 0),
      totalRecordsArchived: history.reduce((sum, s) => sum + s.recordsArchived, 0),
      averageDuration: history.length > 0 ? history.reduce((sum, s) => sum + s.duration, 0) / history.length : 0,
      lastOperation: history[history.length - 1],
      operationsByType: {
        notifications: history.filter((s) => s.operation === 'notifications').length,
        refreshTokens: history.filter((s) => s.operation === 'refresh_tokens').length,
        auditLogs: history.filter((s) => s.operation === 'audit_logs').length,
        sessions: history.filter((s) => s.operation === 'sessions').length,
      },
    };
  }

  /**
   * Clear cleanup history
   */
  clearHistory(): void {
    this.cleanupHistory = [];
  }
}

export default new StaleDataCleanupManager();
