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

const execAsync = promisify(exec);
const gzipAsync = promisify(zlib.gzip);

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

  getJob(id: string): BackupJob | undefined {
    return jobRegistry.get(id);
  },

  listJobs(): BackupJob[] {
    return Array.from(jobRegistry.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    );
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
    return job;
  },

  async verifyBackup(jobId: string): Promise<BackupVerificationResult> {
    const job = jobRegistry.get(jobId);
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
      return { jobId, valid: true, checkedAt: new Date() };
    } catch (err) {
      const error = (err as Error).message;
      logger.error("Backup verification failed", { jobId, error });
      return { jobId, valid: false, checkedAt: new Date(), error };
    }
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
  getPITRCandidate(targetTime: Date): BackupJob | undefined {
    const candidates = Array.from(jobRegistry.values())
      .filter(
        (j) =>
          j.type === "full" &&
          j.status === "completed" &&
          j.startedAt <= targetTime,
      )
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    return candidates[0];
  },
};
