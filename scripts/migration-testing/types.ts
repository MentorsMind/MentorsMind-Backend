export interface MigrationFile {
  name: string;
  path: string;
  prefix: number;
}

export interface MigrationDiscovery {
  migrations: MigrationFile[];
  duplicatePrefixes: Record<string, string[]>;
  invalidNames: string[];
}

export interface MigrationTiming {
  name: string;
  durationMs: number;
  succeeded: boolean;
}

export interface IntegrityReport {
  tableCount: number;
  foreignKeyCount: number;
  primaryKeyCount: number;
  orphanForeignKeys: number;
  migrationTablePresent: boolean;
}

export interface MigrationTestReport {
  startedAt: string;
  completedAt: string;
  migrationCount: number;
  orderingValid: boolean;
  applied: MigrationTiming[];
  integrityBeforeRollback: IntegrityReport;
  rollbackVerified: boolean;
  integrityAfterRollback: IntegrityReport;
  totalDurationMs: number;
}

export interface SqlResult {
  rows: Array<Record<string, unknown>>;
}

export interface SqlExecutor {
  query(sql: string): Promise<SqlResult>;
}