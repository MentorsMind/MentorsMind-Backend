import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.utils";
import { EncryptionUtil } from "../utils/encryption.utils";
import { StorageService } from "./storage.service";
import { env } from "../config/env";
import pool from "../config/database";

const execAsync = promisify(exec);
const gzipAsync = promisify(zlib.gzip);

interface BackupLogRow {
  id: string;
  backup_type: BackupJob["type"];
  status: BackupJob["status"];
  s3_key: string | null;
  location: string | null;
  size_bytes: number | string;
  duration_ms: number;
  integrity_verified: boolean;
  error: string | null;
  started_at: Date;
  completed_at: Date | null;
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface BackupDestination {
  type: "s3" | "local";
  path: string;
}

export interface BackupConfig {
  schedule: string; // cron expression
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  encryption: boolean;
  compression: boolean;
  destinations: BackupDestination[];
}

export interface BackupJob {
  id: string;
  type: "full" | "incremental" | "wal";
  status: "running" | "completed" | "failed";
  size: number;
  duration: number;
  location: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface BackupVerificationResult {
  jobId: string;
  valid: boolean;
  checkedAt: Date;
  error?: string;
}

export interface PITROptions {
  targetTime: Date;
  backupId: string;
}

// ─── In-memory job registry ───────────────────────────────────────────────────

const jobRegistry = new Map<string, BackupJob>();

function backupJobFromLog(row: BackupLogRow): BackupJob {
  const location =
    row.location ??
    (row.s3_key ? `s3://${env.AWS_S3_BUCKET}/${row.s3_key}` : "");
  const job: BackupJob = {
    id: row.id,
    type: row.backup_type,
    status: row.status,
    size: Number(row.size_bytes),
    duration: row.duration_ms,
    location,
    startedAt: new Date(row.started_at),
    ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
  jobRegistry.set(job.id, job);
  return job;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildS3Key(type: BackupJob["type"], id: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `backups/${type}/${date}/${id}.sql.gz`;
}

function buildLocalPath(type: BackupJob["type"], id: string): string {
  const dir = path.join(process.cwd(), "backups", type);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}.sql.gz`);
}

async function dumpDatabase(): Promise<Buffer> {
  const { DATABASE_URL } = env;
  const tmpFile = path.join("/tmp", `pg_dump_${Date.now()}.sql`);

  try {
    await execAsync(`pg_dump "${DATABASE_URL}" -f "${tmpFile}" --no-password`);
    const data = fs.readFileSync(tmpFile);
    return data;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

async function compressBuffer(data: Buffer): Promise<Buffer> {
  return gzipAsync(data);
}

/**
 * Persists a backup job to the durable backup_log table. The in-memory
 * jobRegistry remains the fast path for the current process, but backup_log
 * is the source of truth across restarts (GET /api/v1/admin/backups).
 */
async function persistBackupLog(job: BackupJob): Promise<void> {
  const s3Key = job.location.startsWith("s3://")
    ? job.location.replace(`s3://${env.AWS_S3_BUCKET}/`, "")
    : null;

  await pool
    .query(
      `INSERT INTO backup_log
         (id, backup_type, status, s3_key, location, size_bytes, duration_ms,
          integrity_verified, error, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         s3_key = EXCLUDED.s3_key,
         location = EXCLUDED.location,
         size_bytes = EXCLUDED.size_bytes,
         duration_ms = EXCLUDED.duration_ms,
         integrity_verified = EXCLUDED.integrity_verified,
         error = EXCLUDED.error,
         completed_at = EXCLUDED.completed_at`,
      [
        job.id,
        job.type,
        job.status,
        s3Key,
        job.location || null,
        job.size,
        job.duration,
        false,
        job.error ?? null,
        job.startedAt,
        job.completedAt ?? null,
      ],
    )
    .catch((err) => {
      logger.error("Failed to persist backup_log entry", {
        err,
        jobId: job.id,
      });
    });
}

async function markIntegrityVerified(
  jobId: string,
  verified: boolean,
): Promise<void> {
  await pool
    .query(
      `UPDATE backup_log SET integrity_verified = $2 WHERE id = $1`,
      [jobId, verified],
    )
    .catch((err) => {
      logger.error("Failed to update backup_log integrity flag", {
        err,
        jobId,
      });
    });
}

async function storeBackup(
  data: Buffer,
  config: BackupConfig,
  jobId: string,
  type: BackupJob["type"],
): Promise<string> {
  let payload = data;

  if (config.compression) {
    payload = await compressBuffer(payload);
  }

  if (config.encryption) {
    const encrypted = await EncryptionUtil.encrypt(payload.toString("base64"));
    payload = Buffer.from(encrypted ?? "", "utf8");
  }

  const dest = config.destinations[0];

  if (dest?.type === "s3") {
    const key = buildS3Key(type, jobId);
    await StorageService.uploadFile(key, payload, "application/octet-stream", {
      backupId: jobId,
      backupType: type,
    });
    return `s3://${env.AWS_S3_BUCKET}/${key}`;
  }

  // local fallback
  const localPath = buildLocalPath(type, jobId);
  fs.writeFileSync(localPath, payload);
  return localPath;
}

// ─── BackupService ────────────────────────────────────────────────────────────

export const BackupService = {
  defaultConfig(): BackupConfig {
    return {
      schedule: "0 2 * * *", // daily at 2 AM
      retention: { daily: 7, weekly: 4, monthly: 12 },
      encryption: true,
      compression: true,
      destinations: [{ type: "s3", path: "backups/" }],
    };
  },

  async getJob(id: string): Promise<BackupJob | undefined> {
    const cached = jobRegistry.get(id);
    if (cached) return cached;

    const result = await pool.query<BackupLogRow>(
      `SELECT id, backup_type, status, s3_key, location, size_bytes,
              duration_ms, integrity_verified, error, started_at, completed_at
         FROM backup_log
        WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? backupJobFromLog(result.rows[0]) : undefined;
  },

  async listJobs(): Promise<BackupJob[]> {
    const result = await pool.query<BackupLogRow>(
      `SELECT id, backup_type, status, s3_key, location, size_bytes,
              duration_ms, integrity_verified, error, started_at, completed_at
         FROM backup_log
        ORDER BY started_at DESC`,
    );
    return result.rows.map(backupJobFromLog);
  },

  async runFullBackup(config?: Partial<BackupConfig>): Promise<BackupJob> {
    const cfg = { ...BackupService.defaultConfig(), ...config };
    const job: BackupJob = {
      id: uuidv4(),
      type: "full",
      status: "running",
      size: 0,
      duration: 0,
      location: "",
      startedAt: new Date(),
    };
    jobRegistry.set(job.id, job);
    await persistBackupLog(job);

    const start = Date.now();
    try {
      logger.info("Starting full database backup", { jobId: job.id });

      const dump = await dumpDatabase();
      job.size = dump.length;
      job.location = await storeBackup(dump, cfg, job.id, "full");
      job.status = "completed";
      job.completedAt = new Date();
      job.duration = Date.now() - start;

      logger.info("Full backup completed", {
        jobId: job.id,
        size: job.size,
        duration: job.duration,
        location: job.location,
      });
    } catch (err) {
      job.status = "failed";
      job.error = (err as Error).message;
      job.duration = Date.now() - start;
      logger.error("Full backup failed", { jobId: job.id, error: job.error });
    }

    jobRegistry.set(job.id, job);
    await persistBackupLog(job);
    return job;
  },

  async runWALBackup(config?: Partial<BackupConfig>): Promise<BackupJob> {
    const cfg = { ...BackupService.defaultConfig(), ...config };
    const job: BackupJob = {
      id: uuidv4(),
      type: "wal",
      status: "running",
      size: 0,
      duration: 0,
      location: "",
      startedAt: new Date(),
    };
    jobRegistry.set(job.id, job);
    await persistBackupLog(job);

    const start = Date.now();
    try {
      logger.info("Starting WAL backup", { jobId: job.id });

      // Trigger WAL switch and archive current segment
      const { DATABASE_URL } = env;
      await execAsync(
        `psql "${DATABASE_URL}" -c "SELECT pg_switch_wal();" --no-password`,
      );

      // For WAL archiving we store a marker; real WAL files are handled by pg_basebackup / archive_command
      const marker = Buffer.from(
        JSON.stringify({ jobId: job.id, timestamp: new Date().toISOString() }),
      );
      job.size = marker.length;
      job.location = await storeBackup(marker, cfg, job.id, "wal");
      job.status = "completed";
      job.completedAt = new Date();
      job.duration = Date.now() - start;

      logger.info("WAL backup completed", { jobId: job.id });
    } catch (err) {
      job.status = "failed";
      job.error = (err as Error).message;
      job.duration = Date.now() - start;
      logger.error("WAL backup failed", { jobId: job.id, error: job.error });
    }

    jobRegistry.set(job.id, job);
    await persistBackupLog(job);
    return job;
  },

  /**
   * Durable backup history from backup_log, independent of the in-memory
   * registry (survives process restarts). Backs GET /api/v1/admin/backups.
   */
  async listBackups(limit = 50, offset = 0): Promise<{
    data: Array<{
      id: string;
      backup_type: string;
      status: string;
      s3_key: string | null;
      location: string | null;
      size_bytes: number;
      duration_ms: number;
      integrity_verified: boolean;
      error: string | null;
      started_at: Date;
      completed_at: Date | null;
    }>;
    total: number;
  }> {
    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, backup_type, status, s3_key, location, size_bytes, duration_ms,
                integrity_verified, error, started_at, completed_at
           FROM backup_log
          ORDER BY started_at DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM backup_log`),
    ]);

    return {
      data: dataResult.rows.map((row) => ({
        ...row,
        location:
          row.location ??
          (row.s3_key ? `s3://${env.AWS_S3_BUCKET}/${row.s3_key}` : null),
      })),
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async verifyBackup(jobId: string): Promise<BackupVerificationResult> {
    const job = await BackupService.getJob(jobId);
    if (!job) {
      return {
        jobId,
        valid: false,
        checkedAt: new Date(),
        error: "Job not found",
      };
    }

    try {
      if (job.location.startsWith("s3://")) {
        const key = job.location.replace(`s3://${env.AWS_S3_BUCKET}/`, "");
        await StorageService.generatePresignedUrl(key, 60);
      } else {
        if (!fs.existsSync(job.location)) {
          throw new Error("Backup file not found on disk");
        }
      }

      logger.info("Backup verification passed", { jobId });
      await markIntegrityVerified(jobId, true);
      return { jobId, valid: true, checkedAt: new Date() };
    } catch (err) {
      const error = (err as Error).message;
      logger.error("Backup verification failed", { jobId, error });
      await markIntegrityVerified(jobId, false);
      return { jobId, valid: false, checkedAt: new Date(), error };
    }
  },

  /**
   * Admin-facing PITR entry point. Resolves the best backup candidate for a
   * target restore point; actual restore execution is an operator action
   * per the disaster-recovery runbook (docs/disaster-recovery.md) since it
   * requires taking the primary offline.
   */
  async restoreToPoint(timestamp: Date): Promise<{
    candidate: BackupJob;
    instructions: string;
  }> {
    const candidate = await BackupService.getPITRCandidate(timestamp);
    if (!candidate) {
      const err: any = new Error(
        "No suitable backup found for the given target time",
      );
      err.statusCode = 404;
      throw err;
    }

    logger.warn("PITR restore requested", {
      targetTime: timestamp,
      candidateJobId: candidate.id,
    });

    return {
      candidate,
      instructions:
        "See docs/disaster-recovery.md for the PITR runbook. Restore " +
        `backup ${candidate.id} (${candidate.location}), then replay WAL ` +
        "segments up to the target time.",
    };
  },

  async applyRetentionPolicy(
    config?: Partial<BackupConfig>,
  ): Promise<{ removed: number }> {
    const cfg = { ...BackupService.defaultConfig(), ...config };
    const now = Date.now();
    let removed = 0;

    for (const [id, job] of jobRegistry.entries()) {
      if (job.status !== "completed") continue;

      const ageMs = now - job.startedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      const maxDays = cfg.retention.daily;
      if (ageDays > maxDays) {
        jobRegistry.delete(id);
        removed++;
        logger.info("Removed expired backup from registry", {
          jobId: id,
          ageDays,
        });
      }
    }

    return { removed };
  },

  /**
   * Point-in-time recovery: returns the most recent completed full backup
   * before the target time. Actual restore must be performed by an operator
   * using the returned backup location + WAL logs.
   */
  async getPITRCandidate(targetTime: Date): Promise<BackupJob | undefined> {
    const result = await pool.query<BackupLogRow>(
      `SELECT id, backup_type, status, s3_key, location, size_bytes,
              duration_ms, integrity_verified, error, started_at, completed_at
         FROM backup_log
        WHERE backup_type = 'full'
          AND status = 'completed'
          AND started_at <= $1
        ORDER BY started_at DESC
        LIMIT 1`,
      [targetTime],
    );
    return result.rows[0] ? backupJobFromLog(result.rows[0]) : undefined;
  },
};
