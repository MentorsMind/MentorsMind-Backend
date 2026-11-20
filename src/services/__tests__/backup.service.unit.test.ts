jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock("../../config/env", () => ({
  env: { AWS_S3_BUCKET: "test-backups" },
}));
jest.mock("../../utils/logger.utils", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../utils/encryption.utils", () => ({
  EncryptionUtil: { encrypt: jest.fn() },
}));
jest.mock("../storage.service", () => ({
  StorageService: {},
}));

import pool from "../../config/database";
import { BackupService } from "../backup.service";

const query = pool.query as jest.Mock;

describe("BackupService durable history", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it("loads an individual persisted job when it is not in the process cache", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "job-1",
          backup_type: "full",
          status: "failed",
          s3_key: null,
          location: "/backups/full/job-1.sql.gz",
          size_bytes: "123",
          duration_ms: 45,
          integrity_verified: false,
          error: "backup failed",
          started_at: "2026-01-01T00:00:00.000Z",
          completed_at: null,
        },
      ],
    });

    await expect(BackupService.getJob("job-1")).resolves.toEqual({
      id: "job-1",
      type: "full",
      status: "failed",
      size: 123,
      duration: 45,
      location: "/backups/full/job-1.sql.gz",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      error: "backup failed",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM backup_log"),
      ["job-1"],
    );
  });

  it("lists persisted jobs in database order", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "job-2",
          backup_type: "wal",
          status: "completed",
          s3_key: "backups/wal/job-2.sql.gz",
          location: null,
          size_bytes: 10,
          duration_ms: 5,
          integrity_verified: true,
          error: null,
          started_at: "2026-01-02T00:00:00.000Z",
          completed_at: "2026-01-02T00:00:05.000Z",
        },
      ],
    });

    await expect(BackupService.listJobs()).resolves.toEqual([
      {
        id: "job-2",
        type: "wal",
        status: "completed",
        size: 10,
        duration: 5,
        location: "s3://test-backups/backups/wal/job-2.sql.gz",
        startedAt: new Date("2026-01-02T00:00:00.000Z"),
        completedAt: new Date("2026-01-02T00:00:05.000Z"),
      },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY started_at DESC"),
    );
  });
});
