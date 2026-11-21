jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../utils/sanitization.utils", () => ({
  anonymizeIp: jest.fn(),
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/tenant-context.utils", () => ({
  TenantContext: { getTenantId: jest.fn() },
}));

jest.mock("../../config/metrics", () => ({
  auditLogQueueRejectionsTotal: { inc: jest.fn() },
}));

import pool from "../../config/database";
import { AuditLogService } from "../auditLog.service";

describe("AuditLogService redacted chain verification", () => {
  it("checks redacted rows' chain links without recomputing their original HMAC", async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          id: "log-1",
          user_id: null,
          action: "PROFILE_UPDATE",
          resource_type: "user",
          resource_id: null,
          old_value: null,
          new_value: null,
          ip_address: null,
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          previous_hash: null,
          record_hash: "original-record-hash",
          hash_algorithm: "hmac-sha256-redacted",
        },
      ],
    });

    const result = await AuditLogService.verifyChainIntegrity();

    expect(result).toMatchObject({
      valid: true,
      errors: [],
      checkedCount: 1,
    });
  });
});
