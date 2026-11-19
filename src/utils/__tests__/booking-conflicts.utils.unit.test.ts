import {
  sleep,
  waitForAdvisoryLock,
  withAdvisoryLock,
  AdvisoryLockClient,
  doTimeSlotsOverlap,
  calculateEndTime,
  isBookingInFuture,
  isWithinBusinessHours,
  formatConflictMessage,
  isValidDuration,
  calculateRefundEligibility,
} from "../booking-conflicts.utils";
import { logger } from "../logger.utils";
import { ErrorCode } from "../../errors/error-codes";

jest.mock("../logger.utils", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("booking-conflicts.utils - Advisory Lock & Exponential Backoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sleep", () => {
    it("resolves after the specified duration", async () => {
      const start = Date.now();
      await sleep(15);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });

    it("handles 0 or negative values without error", async () => {
      await expect(sleep(0)).resolves.toBeUndefined();
      await expect(sleep(-50)).resolves.toBeUndefined();
    });
  });

  describe("waitForAdvisoryLock", () => {
    it("acquires lock immediately on first attempt without sleeping", async () => {
      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ locked: true }] }),
      };
      const mockSleep = jest.fn().mockResolvedValue(undefined);

      const acquired = await waitForAdvisoryLock(
        mockClient,
        "mentor-1:2026-05-01T10:00:00.000Z",
        5000,
        { sleepFn: mockSleep },
      );

      expect(acquired).toBe(true);
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      expect(mockClient.query).toHaveBeenCalledWith(
        "SELECT pg_try_advisory_xact_lock(hashtext($1)) as locked",
        ["mentor-1:2026-05-01T10:00:00.000Z"],
      );
      expect(mockSleep).not.toHaveBeenCalled();

      // Total attempt count logged at debug level
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Advisory lock acquired after 1 attempts"),
        expect.objectContaining({
          key: "mentor-1:2026-05-01T10:00:00.000Z",
          attempts: 1,
        }),
      );
    });

    it("acquires lock after contention and logs total attempt count at debug level", async () => {
      let callCount = 0;
      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockImplementation(async () => {
          callCount++;
          // Fail 3 times, succeed on 4th attempt
          return { rows: [{ locked: callCount >= 4 }] };
        }),
      };
      const sleepDelays: number[] = [];
      const mockSleep = jest.fn().mockImplementation(async (ms: number) => {
        sleepDelays.push(ms);
      });

      const acquired = await waitForAdvisoryLock(
        mockClient,
        "mentor-2:2026-05-01T11:00:00.000Z",
        5000,
        { sleepFn: mockSleep },
      );

      expect(acquired).toBe(true);
      expect(mockClient.query).toHaveBeenCalledTimes(4);
      expect(sleepDelays).toHaveLength(3);

      // Verify total attempt count is logged at debug level
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Advisory lock acquired after 4 attempts"),
        expect.objectContaining({
          key: "mentor-2:2026-05-01T11:00:00.000Z",
          attempts: 4,
        }),
      );
    });

    it("uses exponential backoff doubling up to max delay of 500ms with jitter ±10ms", async () => {
      let callCount = 0;
      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockImplementation(async () => {
          callCount++;
          return { rows: [{ locked: callCount >= 9 }] };
        }),
      };

      const recordedDelays: number[] = [];
      const mockSleep = jest.fn().mockImplementation(async (ms: number) => {
        recordedDelays.push(ms);
      });

      // Fix random to 0.5 (jitter = 0) to verify deterministic base doubling
      const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.5);

      await waitForAdvisoryLock(
        mockClient,
        "mentor-jitter-test",
        5000,
        { sleepFn: mockSleep },
      );

      randomSpy.mockRestore();

      // Base sequence before 500ms cap: 10, 20, 40, 80, 160, 320, 500, 500
      expect(recordedDelays).toEqual([10, 20, 40, 80, 160, 320, 500, 500]);
    });

    it("applies jitter within ±10ms range", async () => {
      let callCount = 0;
      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockImplementation(async () => {
          callCount++;
          return { rows: [{ locked: callCount >= 4 }] };
        }),
      };

      const recordedDelays: number[] = [];
      const mockSleep = jest.fn().mockImplementation(async (ms: number) => {
        recordedDelays.push(ms);
      });

      await waitForAdvisoryLock(
        mockClient,
        "mentor-jitter-bounds",
        5000,
        { sleepFn: mockSleep },
      );

      // Attempt 1 delay was 10ms with ±10ms jitter: range [0, 20]
      expect(recordedDelays[0]).toBeGreaterThanOrEqual(0);
      expect(recordedDelays[0]).toBeLessThanOrEqual(20);

      // Attempt 2 delay was 20ms with ±10ms jitter: range [10, 30]
      expect(recordedDelays[1]).toBeGreaterThanOrEqual(10);
      expect(recordedDelays[1]).toBeLessThanOrEqual(30);

      // Attempt 3 delay was 40ms with ±10ms jitter: range [30, 50]
      expect(recordedDelays[2]).toBeGreaterThanOrEqual(30);
      expect(recordedDelays[2]).toBeLessThanOrEqual(50);
    });

    it("verifies the backoff sequence does not exceed 5 seconds", async () => {
      let simulatedTime = 1000000;
      const startTime = simulatedTime;
      const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => simulatedTime);

      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockImplementation(async () => {
          // Lock is never acquired (continuous contention)
          return { rows: [{ locked: false }] };
        }),
      };

      const sleepHistory: number[] = [];
      const mockSleep = jest.fn().mockImplementation(async (ms: number) => {
        sleepHistory.push(ms);
        simulatedTime += ms;
      });

      const acquired = await waitForAdvisoryLock(
        mockClient,
        "mentor-contended:2026-05-01T12:00:00.000Z",
        5000,
        { sleepFn: mockSleep },
      );

      nowSpy.mockRestore();

      expect(acquired).toBe(false);

      // Total sleep wait time must never exceed 5000ms (5 seconds)
      const totalSleepTime = sleepHistory.reduce((sum, d) => sum + d, 0);
      expect(totalSleepTime).toBeLessThanOrEqual(5000);
      expect(simulatedTime - startTime).toBeLessThanOrEqual(5000);

      // DB polling is reduced from 50 queries down to ~12-16 attempts
      expect(mockClient.query).toHaveBeenCalled();
      const queryCount = (mockClient.query as jest.Mock).mock.calls.length;
      expect(queryCount).toBeLessThan(20);
      expect(queryCount).toBeGreaterThanOrEqual(8);

      // Logs warning on lock acquisition timeout
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to acquire advisory lock within 5000ms"),
        expect.objectContaining({
          key: "mentor-contended:2026-05-01T12:00:00.000Z",
        }),
      );
    });

    it("respects custom timeoutMs if specified", async () => {
      let simulatedTime = 1000000;
      const startTime = simulatedTime;
      const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => simulatedTime);

      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      };

      const mockSleep = jest.fn().mockImplementation(async (ms: number) => {
        simulatedTime += ms;
      });

      const acquired = await waitForAdvisoryLock(
        mockClient,
        "custom-timeout-key",
        200,
        { sleepFn: mockSleep },
      );

      nowSpy.mockRestore();

      expect(acquired).toBe(false);
      expect(simulatedTime - startTime).toBeLessThanOrEqual(200);
    });
  });

  describe("withAdvisoryLock", () => {
    it("acquires lock and returns true when called without callback", async () => {
      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ locked: true }] }),
      };

      const result = await withAdvisoryLock(mockClient, "direct-lock-key", 5000);
      expect(result).toBe(true);
    });

    it("acquires lock and executes callback, returning callback result", async () => {
      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ locked: true }] }),
      };

      const callback = jest.fn().mockResolvedValue("booking-created-payload");

      const result = await withAdvisoryLock(
        mockClient,
        "callback-lock-key",
        callback,
        5000,
      );

      expect(result).toBe("booking-created-payload");
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("throws 409 conflict error when lock cannot be acquired within timeout", async () => {
      let simulatedTime = 1000000;
      const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => simulatedTime);

      const mockClient: AdvisoryLockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      };

      const mockSleep = jest.fn().mockImplementation(async (ms: number) => {
        simulatedTime += ms;
      });

      // Override default sleep during test
      const callback = jest.fn();

      await expect(
        withAdvisoryLock(mockClient, "timeout-key", callback, 50, { sleepFn: mockSleep }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCode.BOOKING_CONFLICT,
      });

      expect(callback).not.toHaveBeenCalled();
      nowSpy.mockRestore();
    });
  });

  describe("domain conflict detection helpers", () => {
    it("doTimeSlotsOverlap correctly identifies overlaps", () => {
      const slot1 = {
        start: new Date("2026-05-01T10:00:00Z"),
        end: new Date("2026-05-01T11:00:00Z"),
      };
      const slot2 = {
        start: new Date("2026-05-01T10:30:00Z"),
        end: new Date("2026-05-01T11:30:00Z"),
      };
      const nonOverlapping = {
        start: new Date("2026-05-01T11:00:00Z"),
        end: new Date("2026-05-01T12:00:00Z"),
      };

      expect(doTimeSlotsOverlap(slot1, slot2)).toBe(true);
      expect(doTimeSlotsOverlap(slot1, nonOverlapping)).toBe(false);
    });

    it("calculateEndTime correctly computes end timestamp", () => {
      const start = new Date("2026-05-01T10:00:00Z");
      const end = calculateEndTime(start, 60);
      expect(end.toISOString()).toBe("2026-05-01T11:00:00.000Z");
    });

    it("isValidDuration validates multiples of 15 within bounds", () => {
      expect(isValidDuration(15)).toBe(true);
      expect(isValidDuration(60)).toBe(true);
      expect(isValidDuration(240)).toBe(true);
      expect(isValidDuration(10)).toBe(false);
      expect(isValidDuration(35)).toBe(false);
      expect(isValidDuration(300)).toBe(false);
    });

    it("calculateRefundEligibility computes correct refund tiers", () => {
      const futureSession = new Date(Date.now() + 30 * 3600 * 1000); // 30h ahead
      const mediumNotice = new Date(Date.now() + 15 * 3600 * 1000);  // 15h ahead
      const shortNotice = new Date(Date.now() + 5 * 3600 * 1000);   // 5h ahead

      expect(calculateRefundEligibility(futureSession).refundPercentage).toBe(100);
      expect(calculateRefundEligibility(mediumNotice).refundPercentage).toBe(50);
      expect(calculateRefundEligibility(shortNotice).refundPercentage).toBe(0);
    });
  });
});
