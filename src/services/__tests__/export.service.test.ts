import { ExportService } from "../export.service";
import { ExportJobModel } from "../../models/export-job.model";
import { createError } from "../../middleware/errorHandler";

// Mock dependencies
jest.mock("../../models/export-job.model");
jest.mock("../../queues/export.queue", () => ({
  exportQueue: {
    add: jest.fn().mockResolvedValue({ id: "job-123" }),
  },
}));
jest.mock("../../services/audit-logger.service", () => ({
  AuditLoggerService: {
    logEvent: jest.fn().mockResolvedValue(undefined),
  },
}));

describe("ExportService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("requestExport", () => {
    it("should throw 409 error if user has pending export job", async () => {
      const userId = "user-123";
      const mockPendingJob = {
        id: "job-456",
        user_id: userId,
        status: "pending",
        created_at: new Date(),
      };

      (ExportJobModel.findPendingByUserId as jest.Mock).mockResolvedValue(
        mockPendingJob
      );

      await expect(ExportService.requestExport(userId)).rejects.toEqual(
        createError(
          "An export is already in progress. Please wait for it to complete or check the status.",
          409
        )
      );

      expect(ExportJobModel.findPendingByUserId).toHaveBeenCalledWith(userId);
      expect(ExportJobModel.create).not.toHaveBeenCalled();
    });

    it("should throw 409 error if user has processing export job", async () => {
      const userId = "user-123";
      const mockProcessingJob = {
        id: "job-789",
        user_id: userId,
        status: "processing",
        created_at: new Date(),
      };

      (ExportJobModel.findPendingByUserId as jest.Mock).mockResolvedValue(
        mockProcessingJob
      );

      await expect(ExportService.requestExport(userId)).rejects.toEqual(
        createError(
          "An export is already in progress. Please wait for it to complete or check the status.",
          409
        )
      );
    });

    it("should throw 429 error if within 24-hour cooldown period", async () => {
      const userId = "user-123";
      const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
      const mockCompletedJob = {
        id: "job-completed",
        user_id: userId,
        status: "completed",
        created_at: twentyHoursAgo,
      };

      (ExportJobModel.findPendingByUserId as jest.Mock).mockResolvedValue(null);
      (ExportJobModel.findLastCompletedByUserId as jest.Mock).mockResolvedValue(
        mockCompletedJob
      );

      await expect(ExportService.requestExport(userId)).rejects.toEqual(
        createError(
          "You can request a new export in 4 hour(s). Please wait before requesting another export.",
          429
        )
      );

      expect(ExportJobModel.create).not.toHaveBeenCalled();
    });

    it("should allow export if no pending job and cooldown period has passed", async () => {
      const userId = "user-123";
      const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000);
      const mockCompletedJob = {
        id: "job-old",
        user_id: userId,
        status: "completed",
        created_at: thirtyHoursAgo,
      };
      const mockNewJob = {
        id: "job-new-123",
        user_id: userId,
        status: "pending",
        created_at: new Date(),
      };

      (ExportJobModel.findPendingByUserId as jest.Mock).mockResolvedValue(null);
      (ExportJobModel.findLastCompletedByUserId as jest.Mock).mockResolvedValue(
        mockCompletedJob
      );
      (ExportJobModel.create as jest.Mock).mockResolvedValue(mockNewJob);

      const jobId = await ExportService.requestExport(userId);

      expect(jobId).toBe("job-new-123");
      expect(ExportJobModel.findPendingByUserId).toHaveBeenCalledWith(userId);
      expect(ExportJobModel.findLastCompletedByUserId).toHaveBeenCalledWith(
        userId
      );
      expect(ExportJobModel.create).toHaveBeenCalledWith(userId);
    });

    it("should allow export if no previous exports exist", async () => {
      const userId = "user-456";
      const mockNewJob = {
        id: "job-first",
        user_id: userId,
        status: "pending",
        created_at: new Date(),
      };

      (ExportJobModel.findPendingByUserId as jest.Mock).mockResolvedValue(null);
      (ExportJobModel.findLastCompletedByUserId as jest.Mock).mockResolvedValue(
        null
      );
      (ExportJobModel.create as jest.Mock).mockResolvedValue(mockNewJob);

      const jobId = await ExportService.requestExport(userId);

      expect(jobId).toBe("job-first");
      expect(ExportJobModel.create).toHaveBeenCalledWith(userId);
    });
  });

  describe("jsonToCsv", () => {
    it("should handle fields with newlines correctly", () => {
      const items = [
        {
          id: "1",
          name: "Test User",
          bio: "Line 1\nLine 2\nLine 3",
          notes: "Note with\nnewline",
        },
      ];

      const csv = ExportService.jsonToCsv(items);
      // Should contain escaped newlines as \n within quoted fields
      expect(csv).toContain('"Line 1\\nLine 2\\nLine 3"');
      expect(csv).toContain('"Note with\\nnewline"');
      // Should have exactly 2 lines (header + 1 data row)
      const lines = csv.split("\r\n");
      expect(lines.length).toBe(2);
    });

    it("should handle fields with commas and double quotes correctly", () => {
      const items = [
        {
          id: "1",
          name: 'User "Tester"',
          bio: "Bio, with, commas",
          notes: 'Note "with" quotes',
        },
      ];

      const csv = ExportService.jsonToCsv(items);
      // Should properly escape quotes and commas
      expect(csv).toContain('"""User ""Tester"""""'); // Escaped quotes
      expect(csv).toContain('"""Bio, with, commas"""'); // Commas inside quotes
      expect(csv).toContain('"""Note ""with"" quotes"""'); // Escaped quotes
    });

    it("should handle fields with newlines, commas, and double quotes combined", () => {
      const items = [
        {
          id: "1",
          complexField: 'Line 1\nLine 2,"quoted, value",Line 3',
        },
      ];

      const csv = ExportService.jsonToCsv(items);
      // Should handle all special characters correctly
      expect(csv).toContain('"Line 1\\nLine 2,\"quoted, value\",Line 3"');
      // Should have exactly 2 lines (header + 1 data row)
      const lines = csv.split("\r\n");
      expect(lines.length).toBe(2);
    });

    it("should return empty string for empty array", () => {
      const csv = ExportService.jsonToCsv([]);
      expect(csv).toBe("");
    });

    it("should handle null values correctly", () => {
      const items = [
        {
          id: "1",
          name: "Test",
          nullableField: null,
        },
      ];

      const csv = ExportService.jsonToCsv(items);
      expect(csv).toContain(",,"); // Empty value for null
    });
  });
});
