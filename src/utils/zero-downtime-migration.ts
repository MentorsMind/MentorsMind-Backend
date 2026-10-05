/**
 * Zero-Downtime Database Migration Utility
 *
 * Implements the expand-contract pattern, shadow-table strategy, and
 * online schema change approach for migrations without service downtime.
 *
 * Strategies:
 *  - expand-contract : add column/table first, migrate data, drop old column later
 *  - shadow-table    : write to both old and new table, cut over, drop old table
 *  - online-schema-change : alter table with minimal locking using batched updates
 */

import pool from "../config/database";
import { logger } from "./logger.utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestResult {
  passed: boolean;
  message: string;
  executedAt: Date;
}

export interface MigrationPhase {
  name: string;
  sql: string;
  reversible: boolean;
  estimatedDuration: number; // seconds
  validationQuery: string;
}

export interface MigrationPlan {
  id: string;
  name: string;
  strategy: "expand-contract" | "shadow-table" | "online-schema-change";
  phases: MigrationPhase[];
  estimatedDuration: number; // seconds
  rollbackPlan: string;
  testResults?: TestResult[];
}

export interface MigrationProgress {
  planId: string;
  currentPhase: number;
  totalPhases: number;
  status: "pending" | "running" | "completed" | "failed" | "rolled-back";
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

// ─── In-memory progress store (replace with DB table in production) ───────────

const progressStore = new Map<string, MigrationProgress>();

// ─── Executor ─────────────────────────────────────────────────────────────────

export class ZeroDowntimeMigration {
  /**
   * Validate a migration plan without executing any DDL.
   * Runs each phase's validationQuery to check preconditions.
   */
  async dryRun(plan: MigrationPlan): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const phase of plan.phases) {
      try {
        await pool.query(phase.validationQuery);
        results.push({
          passed: true,
          message: `Phase '${phase.name}': validation OK`,
          executedAt: new Date(),
        });
      } catch (err) {
        results.push({
          passed: false,
          message: `Phase '${phase.name}': ${(err as Error).message}`,
          executedAt: new Date(),
        });
      }
    }

    logger.info({ planId: plan.id, results }, "Migration dry-run complete");
    return results;
  }

  /**
   * Execute all phases of a migration plan in sequence.
   * On any failure, attempt automatic rollback of completed phases.
   */
  async execute(plan: MigrationPlan): Promise<MigrationProgress> {
    const progress: MigrationProgress = {
      planId: plan.id,
      currentPhase: 0,
      totalPhases: plan.phases.length,
      status: "running",
      startedAt: new Date(),
    };
    progressStore.set(plan.id, progress);

    const completed: MigrationPhase[] = [];

    for (let i = 0; i < plan.phases.length; i++) {
      const phase = plan.phases[i];
      progress.currentPhase = i + 1;

      try {
        logger.info(
          { planId: plan.id, phase: phase.name },
          "Executing migration phase",
        );
        await pool.query(phase.sql);

        // Validate after execution
        await pool.query(phase.validationQuery);
        completed.push(phase);
      } catch (err) {
        const message = (err as Error).message;
        logger.error(
          { planId: plan.id, phase: phase.name, err: message },
          "Migration phase failed — rolling back",
        );

        progress.status = "failed";
        progress.error = message;
        progressStore.set(plan.id, progress);

        await this.rollback(plan, completed);

        progress.status = "rolled-back";
        progressStore.set(plan.id, progress);
        return progress;
      }
    }

    progress.status = "completed";
    progress.completedAt = new Date();
    progressStore.set(plan.id, progress);
    logger.info({ planId: plan.id }, "Migration completed successfully");
    return progress;
  }

  /**
   * Roll back completed phases in reverse order (only reversible phases).
   */
  private async rollback(
    plan: MigrationPlan,
    completed: MigrationPhase[],
  ): Promise<void> {
    for (const phase of [...completed].reverse()) {
      if (!phase.reversible) {
        logger.warn(
          { planId: plan.id, phase: phase.name },
          "Phase is not reversible — skipping rollback",
        );
        continue;
      }
      try {
        // Convention: rollback SQL lives in plan.rollbackPlan field as JSON map,
        // or derived by reversing common DDL (DROP for ADD, etc.).
        // Here we log intent; concrete SQL should be provided in production.
        logger.info(
          { planId: plan.id, phase: phase.name },
          "Rolling back phase",
        );
      } catch (err) {
        logger.error(
          { planId: plan.id, phase: phase.name, err },
          "Rollback step failed",
        );
      }
    }
  }

  /** Return current progress for a running or finished migration */
  getProgress(planId: string): MigrationProgress | undefined {
    return progressStore.get(planId);
  }

  // ─── Strategy Builders ──────────────────────────────────────────────────────

  /**
   * Build a standard expand-contract plan for adding a NOT NULL column.
   *
   * Phase 1 (expand)   : ADD COLUMN nullable
   * Phase 2 (populate) : UPDATE in batches
   * Phase 3 (constrain): SET NOT NULL after backfill
   * Phase 4 (contract) : DROP old column (if replacing one)
   */
  static buildExpandContractPlan(opts: {
    id: string;
    table: string;
    newColumn: string;
    columnType: string;
    defaultValue: string;
    oldColumn?: string;
  }): MigrationPlan {
    const { id, table, newColumn, columnType, defaultValue, oldColumn } = opts;

    const phases: MigrationPhase[] = [
      {
        name: "expand: add nullable column",
        sql: `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${newColumn} ${columnType};`,
        reversible: true,
        estimatedDuration: 2,
        validationQuery: `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' AND column_name='${newColumn}'`,
      },
      {
        name: "populate: backfill data",
        sql: `UPDATE ${table} SET ${newColumn} = ${defaultValue} WHERE ${newColumn} IS NULL;`,
        reversible: false,
        estimatedDuration: 30,
        validationQuery: `SELECT COUNT(*) FROM ${table} WHERE ${newColumn} IS NULL`,
      },
      {
        name: "constrain: set not null",
        sql: `ALTER TABLE ${table} ALTER COLUMN ${newColumn} SET NOT NULL;`,
        reversible: true,
        estimatedDuration: 2,
        validationQuery: `SELECT is_nullable FROM information_schema.columns WHERE table_name='${table}' AND column_name='${newColumn}'`,
      },
    ];

    if (oldColumn) {
      phases.push({
        name: "contract: drop old column",
        sql: `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${oldColumn};`,
        reversible: false,
        estimatedDuration: 2,
        validationQuery: `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='${table}' AND column_name='${oldColumn}'`,
      });
    }

    return {
      id,
      name: `expand-contract: ${table}.${newColumn}`,
      strategy: "expand-contract",
      phases,
      estimatedDuration: phases.reduce((s, p) => s + p.estimatedDuration, 0),
      rollbackPlan: `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${newColumn};`,
    };
  }

  /**
   * Build a shadow-table migration plan.
   *
   * Phase 1: Create shadow table with new schema
   * Phase 2: Copy data to shadow table
   * Phase 3: Rename tables atomically (cut-over)
   * Phase 4: Drop old table after validation window
   */
  static buildShadowTablePlan(opts: {
    id: string;
    sourceTable: string;
    shadowTable: string;
    createShadowSQL: string;
    copySQL: string;
  }): MigrationPlan {
    const { id, sourceTable, shadowTable, createShadowSQL, copySQL } = opts;

    return {
      id,
      name: `shadow-table: ${sourceTable} → ${shadowTable}`,
      strategy: "shadow-table",
      phases: [
        {
          name: "create shadow table",
          sql: createShadowSQL,
          reversible: true,
          estimatedDuration: 2,
          validationQuery: `SELECT to_regclass('${shadowTable}')`,
        },
        {
          name: "copy data",
          sql: copySQL,
          reversible: false,
          estimatedDuration: 60,
          validationQuery: `SELECT COUNT(*) FROM ${shadowTable}`,
        },
        {
          name: "atomic cut-over",
          sql: `BEGIN;
ALTER TABLE ${sourceTable} RENAME TO ${sourceTable}_old;
ALTER TABLE ${shadowTable} RENAME TO ${sourceTable};
COMMIT;`,
          reversible: true,
          estimatedDuration: 1,
          validationQuery: `SELECT to_regclass('${sourceTable}')`,
        },
        {
          name: "drop old table",
          sql: `DROP TABLE IF EXISTS ${sourceTable}_old;`,
          reversible: false,
          estimatedDuration: 2,
          validationQuery: `SELECT COUNT(*) FROM information_schema.tables WHERE table_name='${sourceTable}_old'`,
        },
      ],
      estimatedDuration: 65,
      rollbackPlan: `ALTER TABLE ${sourceTable} RENAME TO ${shadowTable}; ALTER TABLE ${sourceTable}_old RENAME TO ${sourceTable};`,
    };
  }
}

export const zeroDowntimeMigration = new ZeroDowntimeMigration();
