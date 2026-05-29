import { ComplianceService } from "../compliance.service";
import pool from "../../config/database";
import { AuditLogService } from "../auditLog.service";

jest.mock("../../config/database", () => ({
  query: jest.fn(),
}));

jest.mock("../auditLog.service", () => ({
  AuditLogService: {
    log: jest.fn(),
  },
}));

describe("ComplianceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createDSAR", () => {
    it("should create a new data subject request and log the event", async () => {
      const mockRequest = {
        id: "dsar-uuid",
        user_id: "user-uuid",
        type: "access",
        status: "pending",
        requested_at: new Date(),
        metadata: {},
        ip_address: "127.0.0.1",
        user_agent: "jest-agent",
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockRequest] });

      const result = await ComplianceService.createDSAR(
        "user-uuid",
        "access",
        "127.0.0.1",
        "jest-agent",
        { source: "ui" },
      );

      expect(result).toEqual(mockRequest);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO data_subject_requests"),
        expect.arrayContaining(["user-uuid", "access", "pending", expect.any(String), "127.0.0.1", "jest-agent"]),
      );
      expect(AuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DSAR_REQUESTED",
          resourceType: "data_subject_request",
          resourceId: "dsar-uuid",
        }),
      );
    });

    it("should reject invalid DSAR types", async () => {
      await expect(
        ComplianceService.createDSAR(
          "user-uuid",
          "unsupported" as any,
          "127.0.0.1",
          "jest-agent",
          {},
        ),
      ).rejects.toThrow("Unsupported DSAR type");
    });
  });

  describe("getRetentionPolicies", () => {
    it("should return retention policies from the database", async () => {
      const mockPolicies = [
        {
          dataType: "users",
          retentionPeriod: 365,
          deletionMethod: "hard",
          legalBasis: "legitimate_interest",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockPolicies });

      const result = await ComplianceService.getRetentionPolicies();
      expect(result).toEqual(mockPolicies);
      expect(pool.query).toHaveBeenCalledWith("SELECT * FROM retention_policies ORDER BY data_type ASC");
    });
  });
});
