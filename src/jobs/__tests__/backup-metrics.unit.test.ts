jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-uuid"),
}));
jest.mock("../../services/backup.service", () => ({
  BackupService: {
    runFullBackup: jest.fn(),
    runWALBackup: jest.fn(),
    applyRetentionPolicy: jest.fn(),
  },
}));
jest.mock("../../services/email.service", () => ({
  emailService: { sendEmail: jest.fn(() => Promise.resolve()) },
}));

import {
  backupDurationSeconds,
  backupOperationsTotal,
  backupSizeBytes,
  metricsRegistry,
} from "../../config/metrics";
import { recordBackupOperation } from "../backup.job";

describe("backup metrics (issue #1303)", () => {
  it("registers backup_duration_seconds histogram with type label", async () => {
    expect(backupDurationSeconds).toBeDefined();
    const metrics = await metricsRegistry.getSingleMetricAsString(
      "backup_duration_seconds",
    );
    expect(metrics).toContain("backup_duration_seconds");
  });

  it("registers backup_operations_total counter with type+status labels", async () => {
    expect(backupOperationsTotal).toBeDefined();
    const metrics = await metricsRegistry.getSingleMetricAsString(
      "backup_operations_total",
    );
    expect(metrics).toContain("backup_operations_total");
  });

  it("recordBackupOperation records duration, status and size", async () => {
    recordBackupOperation("full", 1.5, "success", 1024);
    recordBackupOperation("wal", 0.2, "failure");

    const duration = await metricsRegistry.getSingleMetricAsString(
      "backup_duration_seconds",
    );
    expect(duration).toContain('type="full"');
    expect(duration).toContain('type="wal"');

    const ops = await metricsRegistry.getSingleMetricAsString(
      "backup_operations_total",
    );
    expect(ops).toContain('status="success"');
    expect(ops).toContain('status="failure"');

    const size = await metricsRegistry.getSingleMetricAsString(
      "backup_size_bytes",
    );
    expect(size).toContain('type="full"');
    expect(backupSizeBytes).toBeDefined();
  });

  it("exposes new metrics via GET /metrics registry", async () => {
    const all = await metricsRegistry.metrics();
    expect(all).toContain("backup_duration_seconds");
    expect(all).toContain("backup_operations_total");
  });
});
