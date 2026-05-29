/**
 * Database Maintenance Utility
 * 
 * Handles regular database maintenance tasks:
 * - VACUUM: Reclaims disk space and removes dead rows
 * - ANALYZE: Updates table statistics for query planner
 * - Index rebuilding: Rebuilds fragmented indexes
 * - Table bloat monitoring: Tracks table size growth
 */

import pool from '../config/database';
import { logInfo, logWarning, logError } from './error.utils';

export interface MaintenanceStats {
  timestamp: Date;
  operation: 'vacuum' | 'analyze' | 'index_rebuild' | 'bloat_check';
  status: 'success' | 'failed' | 'warning';
  duration: number; // milliseconds
  details: Record<string, any>;
  message: string;
}

export interface TableBloatInfo {
  schemaName: string;
  tableName: string;
  totalSize: number; // bytes
  deadTuples: number;
  bloatPercentage: number;
  lastVacuum?: Date;
  lastAnalyze?: Date;
}

export interface IndexFragmentation {
  schemaName: string;
  tableName: string;
  indexName: string;
  fragmentation: number; // percentage
  size: number; // bytes
  needsRebuild: boolean;
}

class DatabaseMaintenanceManager {
  private maintenanceHistory: MaintenanceStats[] = [];
  private readonly MAX_HISTORY = 100;
  private readonly BLOAT_THRESHOLD = 20; // percentage
  private readonly FRAGMENTATION_THRESHOLD = 30; // percentage

  /**
   * Run VACUUM on the database
   * Reclaims disk space and removes dead rows
   */
  async runVacuum(full: boolean = false): Promise<MaintenanceStats> {
    const startTime = Date.now();
    const operation = 'vacuum';

    try {
      logInfo(`Starting VACUUM operation (full: ${full})`, {
        timestamp: new Date().toISOString(),
      });

      const command = full ? 'VACUUM FULL ANALYZE' : 'VACUUM ANALYZE';
      await pool.query(command);

      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: 'success',
        duration,
        details: {
          full,
          command,
        },
        message: `VACUUM completed successfully in ${duration}ms`,
      };

      this.recordStats(stats);
      logInfo(`VACUUM completed successfully`, {
        duration,
        full,
      });

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        duration,
        details: {
          error: (error as Error).message,
          full,
        },
        message: `VACUUM failed: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'VACUUM',
        duration,
      });

      throw error;
    }
  }

  /**
   * Run ANALYZE on the database
   * Updates table statistics for query planner optimization
   */
  async runAnalyze(): Promise<MaintenanceStats> {
    const startTime = Date.now();
    const operation = 'analyze';

    try {
      logInfo('Starting ANALYZE operation', {
        timestamp: new Date().toISOString(),
      });

      await pool.query('ANALYZE');

      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: 'success',
        duration,
        details: {},
        message: `ANALYZE completed successfully in ${duration}ms`,
      };

      this.recordStats(stats);
      logInfo('ANALYZE completed successfully', {
        duration,
      });

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        duration,
        details: {
          error: (error as Error).message,
        },
        message: `ANALYZE failed: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'ANALYZE',
        duration,
      });

      throw error;
    }
  }

  /**
   * Rebuild fragmented indexes
   * Rebuilds indexes with fragmentation above threshold
   */
  async rebuildFragmentedIndexes(threshold: number = this.FRAGMENTATION_THRESHOLD): Promise<MaintenanceStats> {
    const startTime = Date.now();
    const operation = 'index_rebuild';

    try {
      logInfo('Starting index fragmentation check and rebuild', {
        threshold,
      });

      // Get fragmented indexes
      const fragmented = await this.getFragmentedIndexes(threshold);

      if (fragmented.length === 0) {
        logInfo('No fragmented indexes found', { threshold });
        return {
          timestamp: new Date(),
          operation,
          status: 'success',
          duration: Date.now() - startTime,
          details: {
            indexesChecked: 0,
            indexesRebuilt: 0,
          },
          message: 'No fragmented indexes found',
        };
      }

      logInfo(`Found ${fragmented.length} fragmented indexes`, {
        threshold,
      });

      // Rebuild each fragmented index
      const rebuiltIndexes: string[] = [];
      for (const index of fragmented) {
        try {
          const indexName = `"${index.schemaName}"."${index.indexName}"`;
          await pool.query(`REINDEX INDEX CONCURRENTLY ${indexName}`);
          rebuiltIndexes.push(index.indexName);
          logInfo(`Rebuilt index: ${index.indexName}`, {
            fragmentation: index.fragmentation,
          });
        } catch (error) {
          logWarning(`Failed to rebuild index: ${index.indexName}`, {
            error: (error as Error).message,
          });
        }
      }

      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: rebuiltIndexes.length === fragmented.length ? 'success' : 'warning',
        duration,
        details: {
          indexesChecked: fragmented.length,
          indexesRebuilt: rebuiltIndexes.length,
          rebuiltIndexes,
          fragmentation: fragmented.map((i) => ({
            name: i.indexName,
            fragmentation: i.fragmentation,
          })),
        },
        message: `Rebuilt ${rebuiltIndexes.length}/${fragmented.length} fragmented indexes in ${duration}ms`,
      };

      this.recordStats(stats);
      logInfo('Index rebuild completed', {
        duration,
        rebuilt: rebuiltIndexes.length,
        total: fragmented.length,
      });

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        duration,
        details: {
          error: (error as Error).message,
        },
        message: `Index rebuild failed: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'index_rebuild',
        duration,
      });

      throw error;
    }
  }

  /**
   * Get fragmented indexes
   */
  private async getFragmentedIndexes(threshold: number): Promise<IndexFragmentation[]> {
    const query = `
      SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch,
        pg_size_pretty(pg_relation_size(indexrelid)) as size,
        ROUND(100.0 * (pg_relation_size(indexrelid) - pg_relation_size(indexrelid, 'main')) / 
              NULLIF(pg_relation_size(indexrelid), 0), 2) as fragmentation
      FROM pg_stat_user_indexes
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY fragmentation DESC;
    `;

    try {
      const result = await pool.query(query);
      return result.rows
        .filter((row: any) => parseFloat(row.fragmentation || 0) > threshold)
        .map((row: any) => ({
          schemaName: row.schemaname,
          tableName: row.tablename,
          indexName: row.indexname,
          fragmentation: parseFloat(row.fragmentation || 0),
          size: row.size,
          needsRebuild: parseFloat(row.fragmentation || 0) > threshold,
        }));
    } catch (error) {
      logWarning('Failed to get fragmented indexes', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Check table bloat
   * Monitors table size and dead tuples
   */
  async checkTableBloat(): Promise<MaintenanceStats> {
    const startTime = Date.now();
    const operation = 'bloat_check';

    try {
      logInfo('Starting table bloat check', {
        threshold: this.BLOAT_THRESHOLD,
      });

      const bloatInfo = await this.getTableBloatInfo();

      // Filter tables with significant bloat
      const bloatedTables = bloatInfo.filter((t) => t.bloatPercentage > this.BLOAT_THRESHOLD);

      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: bloatedTables.length > 0 ? 'warning' : 'success',
        duration,
        details: {
          tablesChecked: bloatInfo.length,
          bloatedTables: bloatedTables.length,
          bloatThreshold: this.BLOAT_THRESHOLD,
          tables: bloatInfo.map((t) => ({
            name: `${t.schemaName}.${t.tableName}`,
            bloatPercentage: t.bloatPercentage,
            totalSize: t.totalSize,
            deadTuples: t.deadTuples,
          })),
        },
        message: `Table bloat check completed. Found ${bloatedTables.length} bloated tables.`,
      };

      this.recordStats(stats);

      if (bloatedTables.length > 0) {
        logWarning(`Found ${bloatedTables.length} bloated tables`, {
          tables: bloatedTables.map((t) => ({
            name: `${t.schemaName}.${t.tableName}`,
            bloat: t.bloatPercentage,
          })),
        });
      } else {
        logInfo('No significant table bloat detected', {
          tablesChecked: bloatInfo.length,
        });
      }

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      const stats: MaintenanceStats = {
        timestamp: new Date(),
        operation,
        status: 'failed',
        duration,
        details: {
          error: (error as Error).message,
        },
        message: `Table bloat check failed: ${(error as Error).message}`,
      };

      this.recordStats(stats);
      logError(error as Error, 'high', {
        operation: 'bloat_check',
        duration,
      });

      throw error;
    }
  }

  /**
   * Get table bloat information
   */
  private async getTableBloatInfo(): Promise<TableBloatInfo[]> {
    const query = `
      SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
        n_dead_tup as dead_tuples,
        ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as bloat_percentage,
        last_vacuum,
        last_analyze
      FROM pg_stat_user_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY n_dead_tup DESC;
    `;

    try {
      const result = await pool.query(query);
      return result.rows.map((row: any) => ({
        schemaName: row.schemaname,
        tableName: row.tablename,
        totalSize: row.total_size,
        deadTuples: row.dead_tuples,
        bloatPercentage: parseFloat(row.bloat_percentage || 0),
        lastVacuum: row.last_vacuum ? new Date(row.last_vacuum) : undefined,
        lastAnalyze: row.last_analyze ? new Date(row.last_analyze) : undefined,
      }));
    } catch (error) {
      logWarning('Failed to get table bloat info', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Run full maintenance cycle
   * Runs VACUUM, ANALYZE, and index rebuild
   */
  async runFullMaintenanceCycle(): Promise<MaintenanceStats[]> {
    const results: MaintenanceStats[] = [];

    try {
      logInfo('Starting full maintenance cycle', {
        timestamp: new Date().toISOString(),
      });

      // Run VACUUM
      results.push(await this.runVacuum(false));

      // Run ANALYZE
      results.push(await this.runAnalyze());

      // Check table bloat
      results.push(await this.checkTableBloat());

      // Rebuild fragmented indexes
      results.push(await this.rebuildFragmentedIndexes());

      logInfo('Full maintenance cycle completed', {
        operations: results.length,
        status: results.every((r) => r.status !== 'failed') ? 'success' : 'partial',
      });

      return results;
    } catch (error) {
      logError(error as Error, 'critical', {
        operation: 'full_maintenance_cycle',
      });
      throw error;
    }
  }

  /**
   * Record maintenance statistics
   */
  private recordStats(stats: MaintenanceStats): void {
    this.maintenanceHistory.push(stats);

    // Keep only recent history
    if (this.maintenanceHistory.length > this.MAX_HISTORY) {
      this.maintenanceHistory = this.maintenanceHistory.slice(-this.MAX_HISTORY);
    }
  }

  /**
   * Get maintenance history
   */
  getMaintenanceHistory(limit: number = 50): MaintenanceStats[] {
    return this.maintenanceHistory.slice(-limit);
  }

  /**
   * Get maintenance statistics
   */
  getMaintenanceStats() {
    const history = this.maintenanceHistory;

    return {
      totalOperations: history.length,
      successfulOperations: history.filter((s) => s.status === 'success').length,
      failedOperations: history.filter((s) => s.status === 'failed').length,
      warningOperations: history.filter((s) => s.status === 'warning').length,
      averageDuration: history.length > 0 ? history.reduce((sum, s) => sum + s.duration, 0) / history.length : 0,
      lastOperation: history[history.length - 1],
      operationsByType: {
        vacuum: history.filter((s) => s.operation === 'vacuum').length,
        analyze: history.filter((s) => s.operation === 'analyze').length,
        indexRebuild: history.filter((s) => s.operation === 'index_rebuild').length,
        bloatCheck: history.filter((s) => s.operation === 'bloat_check').length,
      },
    };
  }

  /**
   * Clear maintenance history
   */
  clearHistory(): void {
    this.maintenanceHistory = [];
  }
}

export default new DatabaseMaintenanceManager();
