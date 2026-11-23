import { DisputeModel } from "../dispute.model";
import pool from "../../config/database";
import { ErrorCode } from "../../errors/error-codes";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

const mockPoolQuery = pool.query as jest.Mock;

describe("DisputeModel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("findOpenBySessionId", () => {
    it("returns open dispute for session when present", async () => {
      const mockDispute = {
        id: "dispute-1",
        session_id: "session-123",
        status: "open",
        filed_by_id: "user-1",
      };
      mockPoolQuery.mockResolvedValueOnce({ rows: [mockDispute] });

      const result = await DisputeModel.findOpenBySessionId("session-123");

      expect(result).toEqual(mockDispute);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining("status NOT IN ('resolved', 'dismissed')"),
        ["session-123"],
      );
    });

    it("returns null when no open dispute exists for session", async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const result = await DisputeModel.findOpenBySessionId("session-empty");

      expect(result).toBeNull();
    });
  });

  describe("findBySessionId", () => {
    it("returns list of disputes for the session", async () => {
      const mockDisputes = [
        { id: "d-1", session_id: "s-1", status: "resolved" },
        { id: "d-2", session_id: "s-1", status: "dismissed" },
      ];
      mockPoolQuery.mockResolvedValueOnce({ rows: mockDisputes });

      const result = await DisputeModel.findBySessionId("s-1");

      expect(result).toEqual(mockDisputes);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE session_id = $1 ORDER BY created_at DESC"),
        ["s-1"],
      );
    });
  });

  describe("create", () => {
    it("throws 409 DISPUTE_ALREADY_EXISTS if an open dispute already exists", async () => {
      // Mock findOpenBySessionId query
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: "existing-1", session_id: "s-100", status: "open" }],
      });

      await expect(
        DisputeModel.create({
          session_id: "s-100",
          filed_by_id: "u-1",
          respondent_id: "u-2",
          type: "quality",
          reason: "Duplicate test",
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: ErrorCode.DISPUTE_ALREADY_EXISTS,
      });
    });

    it("inserts and returns dispute when no open dispute exists", async () => {
      // First query for findOpenBySessionId returns empty
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });
      // Second query for INSERT returns newly created dispute
      const createdRecord = {
        id: "new-dispute-1",
        session_id: "s-200",
        filed_by_id: "u-1",
        respondent_id: "u-2",
        type: "quality",
        reason: "Valid dispute",
        status: "open",
      };
      mockPoolQuery.mockResolvedValueOnce({ rows: [createdRecord] });

      const result = await DisputeModel.create({
        session_id: "s-200",
        filed_by_id: "u-1",
        respondent_id: "u-2",
        type: "quality",
        reason: "Valid dispute",
      });

      expect(result).toEqual(createdRecord);
    });
  });
});
