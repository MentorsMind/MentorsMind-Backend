import { AuditLogService } from "../auditLog.service";
import { TenantContext } from "../../utils/tenant-context.utils";
import pool from "../../config/database";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/sanitization.utils", () => ({
  anonymizeIp: (ip: string) => ip,
}));

const mockedConnect = pool.connect as jest.Mock;

// Column order in the INSERT: $1..$13 are the original fields and
// $14 is tenant_id (see AuditLogService.log).
const TENANT_ID_PARAM_INDEX = 13;

function buildClient() {
  const client = {
    query: jest.fn().mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("INSERT INTO audit_logs")) {
        return Promise.resolve({
          rows: [{ id: "log-1" }],
        });
      }
      // BEGIN / SELECT previous hash / COMMIT
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  mockedConnect.mockResolvedValue(client);
  return client;
}

function getInsertedTenantId(client: { query: jest.Mock }): unknown {
  const insertCall = client.query.mock.calls.find(
    ([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO audit_logs"),
  );
  expect(insertCall).toBeDefined();
  const [, values] = insertCall as [string, unknown[]];
  return values[TENANT_ID_PARAM_INDEX];
}

const baseParams = {
  userId: "user-1",
  action: "test.action",
  resourceType: "test",
};

describe("AuditLogService tenant context (#1076)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUDIT_HMAC_SECRET = "test-secret-that-is-long-enough";
  });

  afterEach(() => {
    delete process.env.AUDIT_HMAC_SECRET;
  });

  it("stores the tenant_id when explicitly provided", async () => {
    const client = buildClient();

    await AuditLogService.log({
      ...baseParams,
      tenantId: "tenant-explicit",
    });

    expect(getInsertedTenantId(client)).toBe("tenant-explicit");
  });

  it("falls back to TenantContext when no tenantId is provided", async () => {
    const client = buildClient();

    await TenantContext.run("tenant-from-context", () =>
      AuditLogService.log({ ...baseParams }),
    );

    expect(getInsertedTenantId(client)).toBe("tenant-from-context");
  });

  it("prefers an explicit tenantId over the ambient TenantContext", async () => {
    const client = buildClient();

    await TenantContext.run("tenant-context", () =>
      AuditLogService.log({ ...baseParams, tenantId: "tenant-explicit" }),
    );

    expect(getInsertedTenantId(client)).toBe("tenant-explicit");
  });

  it("stores NULL tenant_id outside any tenant context (system jobs)", async () => {
    const client = buildClient();

    await AuditLogService.log({ ...baseParams });

    expect(getInsertedTenantId(client)).toBeNull();
  });

  it("stores NULL tenant_id when TenantContext is null", async () => {
    const client = buildClient();

    await TenantContext.run(null, () => AuditLogService.log({ ...baseParams }));

    expect(getInsertedTenantId(client)).toBeNull();
  });

  it("passes tenant_id as a named INSERT column", async () => {
    const client = buildClient();

    await AuditLogService.log({
      ...baseParams,
      tenantId: "tenant-col-check",
    });

    const insertCall = client.query.mock.calls.find(
      ([sql]) =>
        typeof sql === "string" && sql.includes("INSERT INTO audit_logs"),
    );
    const [sql, values] = insertCall as [string, unknown[]];

    // tenant_id appears in the column list and $14 carries its value
    expect(sql).toContain("tenant_id");
    expect(sql).toContain("$14");
    expect(values).toHaveLength(TENANT_ID_PARAM_INDEX + 1);
    expect(values[TENANT_ID_PARAM_INDEX]).toBe("tenant-col-check");
  });
});
