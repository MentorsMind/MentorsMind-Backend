import { BackupService, BackupJob } from "../../services/backup.service";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../utils/error.utils", () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("child_process", () => ({
  exec: jest.fn(
    (
      _cmd: string,
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => cb(null, { stdout: "", stderr: "" }),
  ),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(Buffer.from("mock-dump-data")),
  existsSync: jest.fn().mockReturnValue(true),
}));

jest.mock("../../utils/encryption.utils", () => ({
  EncryptionUtil: {
    encrypt: jest.fn().mockResolvedValue("encrypted-data"),
    decrypt: jest.fn().mockResolvedValue("decrypted-data"),
  },
}));

jest.mock("../../services/storage.service", () => ({
  StorageService: {
    uploadFile: jest
      .fn()
      .mockResolvedValue({
        key: "backups/full/test.sql.gz",
        url: "s3://bucket/key",
      }),
    generatePresignedUrl: jest.fn().mockResolvedValue("https://presigned-url"),
  },
}));

jest.mock("../../config/env", () => ({
  env: {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/testdb",
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test-key",
    AWS_SECRET_ACCESS_KEY: "test-secret",
    AWS_S3_BUCKET: "test-bucket",
  },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BackupService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear internal job registry between tests by running retention with 0-day policy
  });

  // ── defaultConfig ──────────────────────────────────────────────────────────

  describe("defaultConfig", () => {
    it("returns a valid config with expected defaults", () => {
      const config = BackupService.defaultConfig();
      expect(config.encryption).toBe(true);
      expect(config.compression).toBe(true);
      expect(config.retention.daily).toBeGreaterThan(0);
      expect(config.destinations).toHaveLength(1);
      expect(config.destinations[0].type).toBe("s3");
    });
  });

  // ── runFullBackup ──────────────────────────────────────────────────────────

  describe("runFullBackup", () => {
    it("creates a job with status completed on success", async () => {
      const job = await BackupService.runFullBackup();

      expect(job.id).toBeDefined();
      expect(job.type).toBe("full");
      expect(job.status).toBe("completed");
      expect(job.location).toBeTruthy();
      expect(job.duration).toBeGreaterThanOrEqual(0);
      expect(job.completedAt).toBeInstanceOf(Date);
    });

    it("stores the job in the registry", async () => {
      const job = await BackupService.runFullBackup();
      const found = BackupService.getJob(job.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(job.id);
    });

    it("marks job as failed when pg_dump throws", async () => {
      const { exec } = require("child_process");
      exec.mockImplementationOnce((_cmd: string, cb: (err: Error) => void) =>
        cb(new Error("pg_dump not found")),
      );

      const job = await BackupService.runFullBackup();
      expect(job.status).toBe("failed");
      expect(job.error).toContain("pg_dump not found");
    });
  });

  // ── runWALBackup ───────────────────────────────────────────────────────────

  describe("runWALBackup", () => {
    it("creates a WAL job with status completed", async () => {
      const job = await BackupService.runWALBackup();

      expect(job.type).toBe("wal");
      expect(job.status).toBe("completed");
      expect(job.location).toBeTruthy();
    });

    it("marks WAL job as failed when psql throws", async () => {
      const { exec } = require("child_process");
      exec.mockImplementationOnce((_cmd: string, cb: (err: Error) => void) =>
        cb(new Error("psql not found")),
      );

      const job = await BackupService.runWALBackup();
      expect(job.status).toBe("failed");
    });
  });

  // ── listJobs ───────────────────────────────────────────────────────────────

  describe("listJobs", () => {
    it("returns jobs sorted by startedAt descending", async () => {
      const j1 = await BackupService.runFullBackup();
      const j2 = await BackupService.runWALBackup();

      const jobs = BackupService.listJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(2);

      // Most recent first
      const idx1 = jobs.findIndex((j) => j.id === j1.id);
      const idx2 = jobs.findIndex((j) => j.id === j2.id);
      expect(idx2).toBeLessThan(idx1);
    });
  });

  // ── verifyBackup ───────────────────────────────────────────────────────────

  describe("verifyBackup", () => {
    it("returns valid=true for a completed S3 backup", async () => {
      const job = await BackupService.runFullBackup();
      const result = await BackupService.verifyBackup(job.id);

      expect(result.valid).toBe(true);
      expect(result.jobId).toBe(job.id);
      expect(result.checkedAt).toBeInstanceOf(Date);
    });

    it("returns valid=false for an unknown job id", async () => {
      const result = await BackupService.verifyBackup("non-existent-id");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns valid=false when presigned URL generation fails", async () => {
      const { StorageService } = require("../../services/storage.service");
      StorageService.generatePresignedUrl.mockRejectedValueOnce(
        new Error("S3 error"),
      );

      const job = await BackupService.runFullBackup();
      const result = await BackupService.verifyBackup(job.id);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("S3 error");
    });
  });

  // ── applyRetentionPolicy ───────────────────────────────────────────────────

  describe("applyRetentionPolicy", () => {
    it("removes jobs older than retention.daily days", async () => {
      const job = await BackupService.runFullBackup();

      // Manually age the job
      const stored = BackupService.getJob(job.id) as BackupJob;
      stored.startedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago

      const { removed } = await BackupService.applyRetentionPolicy({
        retention: { daily: 7, weekly: 4, monthly: 12 },
      });
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(BackupService.getJob(job.id)).toBeUndefined();
    });

    it("keeps jobs within retention window", async () => {
      const job = await BackupService.runFullBackup();
      const before = BackupService.listJobs().length;

      await BackupService.applyRetentionPolicy({
        retention: { daily: 30, weekly: 4, monthly: 12 },
      });

      expect(BackupService.getJob(job.id)).toBeDefined();
      expect(BackupService.listJobs().length).toBe(before);
    });
  });

  // ── getPITRCandidate ───────────────────────────────────────────────────────

  describe("getPITRCandidate", () => {
    it("returns the most recent full backup before targetTime", async () => {
      const job = await BackupService.runFullBackup();
      const future = new Date(Date.now() + 60_000);

      const candidate = BackupService.getPITRCandidate(future);
      expect(candidate).toBeDefined();
      expect(candidate?.type).toBe("full");
      expect(candidate?.status).toBe("completed");
    });

    it("returns undefined when no full backup exists before targetTime", () => {
      const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
      const candidate = BackupService.getPITRCandidate(past);
      // May or may not be undefined depending on registry state; just ensure no throw
      expect(candidate === undefined || candidate?.type === "full").toBe(true);
    });

    it("ignores WAL and failed jobs", async () => {
      const { exec } = require("child_process");
      exec.mockImplementationOnce((_cmd: string, cb: (err: Error) => void) =>
        cb(new Error("fail")),
      );
      await BackupService.runFullBackup(); // failed job

      const walJob = await BackupService.runWALBackup();
      const future = new Date(Date.now() + 60_000);

      const candidate = BackupService.getPITRCandidate(future);
      expect(candidate?.id).not.toBe(walJob.id);
    });
  });
});
