import { DataExportService } from "../../dataExport.service";
import pool from "../../../config/database";
import { DataExportRequestModel } from "../../../models/data-export-request.model";
import { exportQueue } from "../../../queues/export.queue";

jest.mock("../../../config/database", () => ({
  query: jest.fn(),
}));

jest.mock("../../../models/data-export-request.model", () => ({
  DataExportRequestModel: {
    create: jest.fn(),
    findLatestByUserId: jest.fn(),
    updateStatus: jest.fn(),
  },
}));

jest.mock("../../../queues/export.queue", () => ({
  exportQueue: {
    add: jest.fn(),
  },
}));

describe("DataExportService", () => {
  const userId = "user-123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("requestExport", () => {
    it("should create a request and queue a job if no recent requests exist", async () => {
      (
        DataExportRequestModel.findLatestByUserId as jest.Mock
      ).mockResolvedValue(null);
      (DataExportRequestModel.create as jest.Mock).mockResolvedValue({
        id: "req-1",
        status: "pending",
      });

      const result = await DataExportService.requestExport(userId);

      expect(DataExportRequestModel.create).toHaveBeenCalledWith(userId);
      expect(exportQueue.add).toHaveBeenCalledWith("process-data-export", {
        userId,
        requestId: "req-1",
      });
      expect(result.id).toBe("req-1");
    });

    it("should throw error if a request was made within 30 days", async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);
      (
        DataExportRequestModel.findLatestByUserId as jest.Mock
      ).mockResolvedValue({ requested_at: recentDate, status: "completed" });

      await expect(DataExportService.requestExport(userId)).rejects.toThrow(
        "30 days",
      );
    });

    it("should allow a new request if the last one failed", async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);
      (
        DataExportRequestModel.findLatestByUserId as jest.Mock
      ).mockResolvedValue({ requested_at: recentDate, status: "failed" });
      (DataExportRequestModel.create as jest.Mock).mockResolvedValue({
        id: "req-2",
      });

      await DataExportService.requestExport(userId);
      expect(DataExportRequestModel.create).toHaveBeenCalled();
    });
  });
});
