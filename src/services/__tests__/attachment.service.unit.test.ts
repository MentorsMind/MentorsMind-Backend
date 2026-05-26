import { AttachmentService } from "../attachment.service";

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://signed.example.com/file"),
}));

jest.mock("../../queues/virus-scan.queue", () => ({
  virusScanQueue: { add: jest.fn() },
}));

jest.mock("../socket.service", () => ({
  SocketService: { emitToUser: jest.fn() },
}));

jest.mock("../messaging.service", () => ({
  MessagingService: { sendMessage: jest.fn(), getConversation: jest.fn() },
}));

import pool from "../../config/database";

const mockPool = pool as jest.Mocked<typeof pool>;

const DAILY_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB

beforeEach(() => {
  jest.clearAllMocks();
});

// ── validateFile ───────────────────────────────────────────────────────────────

describe("AttachmentService.validateFile", () => {
  it("accepts a valid JPEG under 10 MB", () => {
    expect(
      AttachmentService.validateFile("image/jpeg", 5 * 1024 * 1024),
    ).toBeNull();
  });

  it("accepts a valid PNG under 10 MB", () => {
    expect(
      AttachmentService.validateFile("image/png", 1 * 1024 * 1024),
    ).toBeNull();
  });

  it("accepts a valid WebP under 10 MB", () => {
    expect(
      AttachmentService.validateFile("image/webp", 8 * 1024 * 1024),
    ).toBeNull();
  });

  it("rejects an image exceeding 10 MB", () => {
    const err = AttachmentService.validateFile("image/jpeg", 11 * 1024 * 1024);
    expect(err).toBe("Image exceeds 10 MB limit");
  });

  it("accepts a PDF under 20 MB", () => {
    expect(
      AttachmentService.validateFile("application/pdf", 15 * 1024 * 1024),
    ).toBeNull();
  });

  it("rejects a PDF exceeding 20 MB", () => {
    const err = AttachmentService.validateFile(
      "application/pdf",
      21 * 1024 * 1024,
    );
    expect(err).toBe("Document exceeds 20 MB limit");
  });

  it("rejects an unsupported MIME type", () => {
    const err = AttachmentService.validateFile("video/mp4", 1 * 1024 * 1024);
    expect(err).toMatch(/Unsupported file type/);
    expect(err).toMatch(/video\/mp4/);
  });
});

// ── checkAndUpdateQuota ────────────────────────────────────────────────────────

describe("AttachmentService.checkAndUpdateQuota", () => {
  const userId = "user-abc";
  const fileSize = 5 * 1024 * 1024; // 5 MB

  describe("quota available — UPDATE succeeds", () => {
    it("returns true when the conditional UPDATE increments bytes_used", async () => {
      // UPDATE matches the row and respects the quota condition
      mockPool.query.mockResolvedValueOnce({
        rows: [{ bytes_used: String(fileSize) }],
        rowCount: 1,
      } as any);

      const result = await AttachmentService.checkAndUpdateQuota(
        userId,
        fileSize,
      );

      expect(result).toBe(true);
      // INSERT step must not be called
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it("passes userId, fileSize, and quota as parameters to the UPDATE", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ bytes_used: String(fileSize) }],
        rowCount: 1,
      } as any);

      await AttachmentService.checkAndUpdateQuota(userId, fileSize);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_upload_quotas"),
        [userId, fileSize, DAILY_QUOTA_BYTES],
      );
    });

    it("returns true at the exact quota boundary (bytes_used + fileSize === quota)", async () => {
      const remaining = DAILY_QUOTA_BYTES - fileSize;
      // Simulate the row already having `remaining` bytes; after update = DAILY_QUOTA_BYTES
      mockPool.query.mockResolvedValueOnce({
        rows: [{ bytes_used: String(DAILY_QUOTA_BYTES) }],
        rowCount: 1,
      } as any);

      const result = await AttachmentService.checkAndUpdateQuota(
        userId,
        fileSize,
      );

      expect(result).toBe(true);
    });
  });

  describe("quota exceeded — UPDATE finds row but WHERE is false", () => {
    it("returns false when the conditional UPDATE matches no rows and INSERT conflicts", async () => {
      // UPDATE returns no rows (quota condition not met)
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      // INSERT returns no rows (ON CONFLICT DO NOTHING — row already exists)
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      const result = await AttachmentService.checkAndUpdateQuota(
        userId,
        fileSize,
      );

      expect(result).toBe(false);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("does not use BEGIN/COMMIT/ROLLBACK — no transaction wrapping", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      await AttachmentService.checkAndUpdateQuota(userId, fileSize);

      const allCalls: string[] = (mockPool.query as jest.Mock).mock.calls.map(
        (c: any[]) => (typeof c[0] === "string" ? c[0].toUpperCase() : ""),
      );
      expect(allCalls.some((q) => q.includes("BEGIN"))).toBe(false);
      expect(allCalls.some((q) => q.includes("COMMIT"))).toBe(false);
      expect(allCalls.some((q) => q.includes("ROLLBACK"))).toBe(false);
    });
  });

  describe("first upload of the day — INSERT succeeds", () => {
    it("returns true when UPDATE finds no row but INSERT creates the first row", async () => {
      // UPDATE returns no rows (no row for today yet)
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      // INSERT creates the first row for today
      mockPool.query.mockResolvedValueOnce({
        rows: [{ bytes_used: String(fileSize) }],
        rowCount: 1,
      } as any);

      const result = await AttachmentService.checkAndUpdateQuota(
        userId,
        fileSize,
      );

      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("passes userId and fileSize to the INSERT", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      mockPool.query.mockResolvedValueOnce({
        rows: [{ bytes_used: String(fileSize) }],
        rowCount: 1,
      } as any);

      await AttachmentService.checkAndUpdateQuota(userId, fileSize);

      expect(mockPool.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("INSERT INTO user_upload_quotas"),
        [userId, fileSize],
      );
    });

    it("INSERT uses ON CONFLICT DO NOTHING to prevent double-counting on concurrent first uploads", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      mockPool.query.mockResolvedValueOnce({
        rows: [{ bytes_used: String(fileSize) }],
        rowCount: 1,
      } as any);

      await AttachmentService.checkAndUpdateQuota(userId, fileSize);

      const insertCall: string = (mockPool.query as jest.Mock).mock.calls[1][0];
      expect(insertCall.toUpperCase()).toContain("ON CONFLICT");
      expect(insertCall.toUpperCase()).toContain("DO NOTHING");
    });
  });

  describe("error propagation", () => {
    it("propagates a database error from the UPDATE step", async () => {
      const dbError = new Error("connection refused");
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        AttachmentService.checkAndUpdateQuota(userId, fileSize),
      ).rejects.toThrow("connection refused");
    });

    it("propagates a database error from the INSERT step", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      const dbError = new Error("unique violation");
      mockPool.query.mockRejectedValueOnce(dbError);

      await expect(
        AttachmentService.checkAndUpdateQuota(userId, fileSize),
      ).rejects.toThrow("unique violation");
    });
  });

  describe("conditional UPDATE query shape", () => {
    it("UPDATE WHERE clause includes the quota guard (bytes_used + file_size <= quota)", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ bytes_used: "1" }],
        rowCount: 1,
      } as any);

      await AttachmentService.checkAndUpdateQuota(userId, fileSize);

      const updateSql: string = (mockPool.query as jest.Mock).mock.calls[0][0];
      // Must contain the conditional guard — not an unconditional increment
      expect(updateSql).toMatch(/bytes_used\s*\+\s*\$2\s*<=\s*\$3/i);
    });

    it("UPDATE does not contain a rollback-style decrement (the old race-condition pattern)", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

      await AttachmentService.checkAndUpdateQuota(userId, fileSize);

      const allSql: string = (mockPool.query as jest.Mock).mock.calls
        .map((c: any[]) => (typeof c[0] === "string" ? c[0] : ""))
        .join("\n");
      // The old pattern subtracted bytes on rollback — must not appear
      expect(allSql).not.toMatch(/bytes_used\s*-\s*\$/);
    });
  });
});
