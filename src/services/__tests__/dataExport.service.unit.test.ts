jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../models/data-export-request.model", () => ({
  DataExportRequestModel: {
    findLatestByUserId: jest.fn(),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../users.service", () => ({
  UsersService: {
    findById: jest.fn().mockResolvedValue({
      email: "user@example.com",
      first_name: "Test",
    }),
  },
}));

jest.mock("../../queues/export.queue", () => ({
  exportQueue: { add: jest.fn() },
}));

jest.mock("../audit-logger.service", () => ({
  AuditLoggerService: { logEvent: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../email.service", () => ({
  emailService: { sendEmail: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../storage.service", () => ({
  StorageService: {
    buildExportKey: jest.fn(),
    uploadFile: jest.fn().mockResolvedValue(undefined),
    generatePresignedUrl: jest
      .fn()
      .mockResolvedValue("https://s3.example/export"),
  },
}));

import crypto from "crypto";
import { DataExportRequestModel } from "../../models/data-export-request.model";
import { ErrorCode } from "../../errors/error-codes";
import { emailService } from "../email.service";
import { StorageService } from "../storage.service";
import { DataExportService } from "../dataExport.service";

describe("DataExportService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws a typed 429 when an export was requested within the last 30 days", async () => {
    (DataExportRequestModel.findLatestByUserId as jest.Mock).mockResolvedValue({
      requested_at: new Date(),
      status: "completed",
    });

    await expect(DataExportService.requestExport("user-1")).rejects.toMatchObject({
      message: "You can only request one data export every 30 days.",
      statusCode: 429,
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
    });
  });

  it("uploads the generated archive to S3 and records its key and checksum", async () => {
    const s3Key = "exports/user-1/request-1/export.zip";
    (StorageService.buildExportKey as jest.Mock).mockReturnValue(s3Key);
    jest
      .spyOn(DataExportService, "collectUserData")
      .mockResolvedValue({ profile: { id: "user-1" } });

    await DataExportService.processExport("user-1", "request-1");

    const [uploadedKey, archiveBuffer, contentType] = (
      StorageService.uploadFile as jest.Mock
    ).mock.calls[0];
    expect(uploadedKey).toBe(s3Key);
    expect(Buffer.isBuffer(archiveBuffer)).toBe(true);
    expect(archiveBuffer.subarray(0, 2).toString()).toBe("PK");
    expect(contentType).toBe("application/zip");

    const completedUpdate = (
      DataExportRequestModel.updateStatus as jest.Mock
    ).mock.calls.find(([, status]) => status === "completed");
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate?.[2]).toMatchObject({
      filePath: s3Key,
      fileSize: archiveBuffer.length,
      checksum: crypto.createHash("sha256").update(archiveBuffer).digest("hex"),
    });
    expect(StorageService.generatePresignedUrl).toHaveBeenCalledWith(
      s3Key,
      48 * 60 * 60,
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlContent: expect.stringContaining("https://s3.example/export"),
      }),
    );
  });
});
