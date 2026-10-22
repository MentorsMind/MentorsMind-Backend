/**
 * Unit tests for BackupJob graceful stop behaviour.
 *
 * Tests verify that stop():
 *  1. Returns immediately when no jobs are running.
 *  2. Waits for a running job to finish before stopping.
 *  3. Force-stops and logs a warning when a job exceeds the 30-second timeout.
 */

// ─── Module mocks (must be before imports) ───────────────────────────────────

jest.mock("../../services/backup.service", () => ({
  BackupService: {
    runFullBackup: jest.fn(),
    runWALBackup: jest.fn(),
    applyRetentionPolicy: jest.fn(),
    verifyBackup: jest.fn(),
  },
}));

jest.mock("../../services/email.service", () => ({
  emailService: { sendEmail: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../utils/error.utils", () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  logError: jest.fn(),
}));

// ─── Fake CronJob ─────────────────────────────────────────────────────────────

type CronCallback = () => Promise<void> | void;

class FakeCronJob {
  running = false;
  private _callback: CronCallback;

  constructor(_schedule: string, callback: CronCallback) {
    this._callback = callback;
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  /** Trigger the callback manually in tests. */
  async fire(): Promise<void> {
    await this._callback();
  }
}

// Inject the fake CronJob via the module-level `require` the job uses.
const fakeCronInstances: FakeCronJob[] = [];

// We intercept the `require("cron")` call inside backup.job.ts by mocking
// the module before it is loaded.
jest.mock("cron", () => ({
  CronJob: jest.fn().mockImplementation((schedule: string, cb: CronCallback) => {
    const instance = new FakeCronJob(schedule, cb);
    fakeCronInstances.push(instance);
    return instance;
  }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { logWarning } from "../../utils/error.utils";

// Re-require the module under test so it picks up the mocked `cron` module.
// We import the default export (the singleton backupJob).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const backupJobModule = require("../backup.job");
const backupJob = backupJobModule.default ?? backupJobModule;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolves after `ms` milliseconds — used to simulate async job work. */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BackupJob.stop() graceful shutdown", () => {
  beforeEach(() => {
    fakeCronInstances.length = 0;
    jest.clearAllMocks();
  });

  it("stops immediately when no jobs are running", async () => {
    backupJob.initialize();

    const start = Date.now();
    await backupJob.stop();
    const elapsed = Date.now() - start;

    // Should complete almost instantly (well under 1 second)
    expect(elapsed).toBeLessThan(500);
  });

  it("waits for a running job to finish before stopping", async () => {
    const { BackupService } = require("../../services/backup.service");

    // Make runFullBackup take 1.5 seconds to simulate an in-progress backup.
    (BackupService.runFullBackup as jest.Mock).mockImplementation(() =>
      delay(1_500).then(() => ({ id: "job-1", status: "completed", size: 0, duration: 1500 })),
    );
    (BackupService.verifyBackup as jest.Mock).mockResolvedValue({ valid: true });

    backupJob.initialize();

    // Fire the daily-full-backup job asynchronously (don't await — we want it running).
    const dailyJob = fakeCronInstances.find((_j, i) => i === 0);
    expect(dailyJob).toBeDefined();
    const firePromise = dailyJob!.fire();

    // Give the callback just enough time to mark itself as running.
    await delay(50);

    const start = Date.now();
    await backupJob.stop();
    const elapsed = Date.now() - start;

    // stop() should have waited for the ~1.5s job to complete.
    expect(elapsed).toBeGreaterThanOrEqual(1_000);
    // No force-stop warning expected.
    expect(logWarning).not.toHaveBeenCalledWith(
      expect.stringContaining("Force-stopping"),
      expect.anything(),
    );

    await firePromise; // clean up
  });

  it("force-stops and logs a warning when a job exceeds the 30-second timeout", async () => {
    jest.useFakeTimers();

    const { BackupService } = require("../../services/backup.service");

    // Simulate a job that never finishes.
    let resolveNeverEnding!: () => void;
    const neverEnding = new Promise<void>((r) => {
      resolveNeverEnding = r;
    });
    (BackupService.runFullBackup as jest.Mock).mockReturnValue(neverEnding);

    backupJob.initialize();

    const dailyJob = fakeCronInstances.find((_j, i) => i === 0);
    expect(dailyJob).toBeDefined();

    // Fire in background — it will hang forever.
    dailyJob!.fire();

    // Give the callback a tick to mark itself as running.
    await Promise.resolve();

    // Start stop() and advance timers past the 30-second deadline.
    const stopPromise = backupJob.stop();
    jest.advanceTimersByTime(31_000);

    await stopPromise;

    expect(logWarning).toHaveBeenCalledWith(
      expect.stringContaining("Force-stopping"),
      expect.objectContaining({ jobName: "daily-full-backup" }),
    );

    // Clean up
    resolveNeverEnding();
    jest.useRealTimers();
  });
});
