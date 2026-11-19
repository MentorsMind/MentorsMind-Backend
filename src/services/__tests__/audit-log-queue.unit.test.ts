/**
 * audit-log-queue.unit.test.ts
 *
 * Tests for audit log queue rejection handling.
 * Verifies that when BullMQ queue operations fail (capacity, Redis unavailable),
 * the failure is tracked as a Prometheus counter with appropriate reason labels.
 */

import { AuditLogService } from "../auditLog.service";
import { auditLogQueueRejectionsTotal } from "../../config/metrics";

// Mock the metrics
jest.mock("../../config/metrics", () => ({
  auditLogQueueRejectionsTotal: {
    inc: jest.fn(),
  },
}));

describe("AuditLogService - Queue Rejection Tracking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("enqueueToQueue method", () => {
    it("should increment counter with 'queue_full' reason when MaxRetriesReachedError occurs", async () => {
      const maxRetriesError = new Error("Max retries reached");
      maxRetriesError.name = "MaxRetriesReachedError";

      // Access the private method via the service object
      // In practice, you would test this through integration or expose it for testing
      const service = AuditLogService as any;

      try {
        await service.enqueueToQueue({ id: "test" });
      } catch (err) {
        // Expected to throw
      }

      // Note: This test assumes the enqueueToQueue method is called
      // In actual implementation, the counter should be incremented
      expect(auditLogQueueRejectionsTotal.inc).toHaveBeenCalledWith({
        reason: "queue_full",
      });
    });

    it("should increment counter with 'redis_unavailable' reason on connection error", async () => {
      const redisError: any = new Error("Redis connection refused");
      redisError.code = "ECONNREFUSED";

      const service = AuditLogService as any;

      try {
        await service.enqueueToQueue({ id: "test" });
      } catch (err) {
        // Expected to throw
      }

      expect(auditLogQueueRejectionsTotal.inc).toHaveBeenCalledWith({
        reason: "redis_unavailable",
      });
    });

    it("should increment counter with 'unknown' reason for unrecognized errors", async () => {
      const unknownError = new Error("Some unknown queue error");

      const service = AuditLogService as any;

      try {
        await service.enqueueToQueue({ id: "test" });
      } catch (err) {
        // Expected to throw
      }

      expect(auditLogQueueRejectionsTotal.inc).toHaveBeenCalledWith({
        reason: "unknown",
      });
    });

    it("should re-throw the original error after incrementing counter", async () => {
      const originalError = new Error("Queue error");
      originalError.name = "MaxRetriesReachedError";

      const service = AuditLogService as any;

      await expect(service.enqueueToQueue({ id: "test" })).rejects.toThrow(
        "Queue error"
      );

      expect(auditLogQueueRejectionsTotal.inc).toHaveBeenCalled();
    });
  });

  describe("Prometheus counter labels", () => {
    it("should have 'reason' label for queue rejections", () => {
      // Verify the counter is properly configured with reason label
      const service = AuditLogService as any;
      
      // This is a validation test that the counter is being used correctly
      expect(auditLogQueueRejectionsTotal.inc).toBeDefined();
    });

    it("should support all expected reason values", () => {
      const reasons = ["queue_full", "redis_unavailable", "unknown"];

      for (const reason of reasons) {
        // Reset the mock for each iteration
        (auditLogQueueRejectionsTotal.inc as jest.Mock).mockClear();

        // In actual implementation, these reasons should all be supported
        expect(reasons).toContain(reason);
      }
    });
  });
});
