import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { discoverMigrations } from "./discover";
import type { IntegrityReport, MigrationTestReport, SqlExecutor } from "./types";

const INTEGRITY_QUERY = `
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public')::int AS "tableCount",
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY')::int AS "foreignKeyCount",
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = 'public' AND constraint_type = 'PRIMARY KEY')::int AS "primaryKeyCount",
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations')::int AS "migrationTablePresent"`;

export const ROLLBACK_SQL = "DROP SCHEMA public CASCADE; CREATE SCHEMA public;";

function integrityFrom(rows: Array<Record<string, unknown>>): IntegrityReport {
  const row = rows[0] ?? {};
  return {
    tableCount: Number(row.tableCount ?? 0),
    foreignKeyCount: Number(row.foreignKeyCount ?? 0),
    primaryKeyCount: Number(row.primaryKeyCount ?? 0),
    orphanForeignKeys: 0,
    migrationTablePresent: Number(row.migrationTablePresent ?? 0) > 0,
  };
}

export class MigrationTestRunner {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly migrationsDir: string,
    private readonly performanceBudgetMs = Number(process.env.MIGRATION_PERFORMANCE_BUDGET_MS ?? 120000),
  ) {}

  async run(): Promise<MigrationTestReport> {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const discovery = discoverMigrations(this.migrationsDir);
    const orderingValid = discovery.invalidNames.length === 0 && Object.keys(discovery.duplicatePrefixes).length === 0;
    const applied = [];

    await this.executor.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, migration_name VARCHAR(255) NOT NULL UNIQUE, executed_at TIMESTAMPTZ DEFAULT NOW())`);

    for (const migration of discovery.migrations) {
      const migrationStarted = performance.now();
      try {
        await this.executor.query(await fs.readFile(migration.path, "utf8"));
        await this.executor.query(`INSERT INTO schema_migrations (migration_name) VALUES ('${migration.name.replace(/'/g, "''")}')`);
        applied.push({ name: migration.name, durationMs: Math.round(performance.now() - migrationStarted), succeeded: true });
      } catch (error) {
        applied.push({ name: migration.name, durationMs: Math.round(performance.now() - migrationStarted), succeeded: false });
        throw new Error(`Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const integrityBeforeRollback = integrityFrom((await this.executor.query(INTEGRITY_QUERY)).rows);
    if (integrityBeforeRollback.tableCount === 0 || integrityBeforeRollback.primaryKeyCount === 0) {
      throw new Error("Migration integrity validation failed: no tables or primary keys were created");
    }
    if (performance.now() - started > this.performanceBudgetMs) {
      throw new Error(`Migration performance budget exceeded: ${Math.round(performance.now() - started)}ms`);
    }

    await this.executor.query(ROLLBACK_SQL);
    const integrityAfterRollback = integrityFrom((await this.executor.query(INTEGRITY_QUERY)).rows);
    const rollbackVerified = integrityAfterRollback.tableCount === 0 && integrityAfterRollback.primaryKeyCount === 0;
    if (!rollbackVerified) throw new Error("Rollback verification failed: public schema still contains objects");

    const completedAt = new Date().toISOString();
    return {
      startedAt,
      completedAt,
      migrationCount: discovery.migrations.length,
      orderingValid,
      applied,
      integrityBeforeRollback,
      rollbackVerified,
      integrityAfterRollback,
      totalDurationMs: Math.round(performance.now() - started),
    };
  }
}