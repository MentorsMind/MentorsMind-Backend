jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    query: jest.fn(),
  },
}));

jest.mock("../email.service", () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    sendEmail: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../../queues/email.queue", () => ({
  enqueueEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../cache.service", () => ({
  CacheService: { invalidatePattern: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import pool from "../../config/database";
import { accountDeletionService } from "../accountDeletion.service";

describe("accountDeletionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("anonymizes audit records with a pseudonym instead of deleting them", async () => {
    const client = {
      query: jest.fn(async (query: string, params?: unknown[]) => {
        if (query.includes("information_schema.tables")) {
          return {
            rows: [
              {
                present:
                  query.includes("table_name = 'audit_logs'") ||
                  params?.[0] === "audit_logs",
              },
            ],
          };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    (pool.connect as jest.Mock).mockResolvedValue(client);

    await accountDeletionService.eraseUser({
      id: "user-1",
      email: "user@example.com",
      full_name: "Test User",
      deletion_requested_at: null,
      deletion_scheduled_for: null,
      deletion_completed_at: null,
    });

    const auditUpdate = client.query.mock.calls.find(([query]) =>
      query.includes("UPDATE audit_logs"),
    );
    expect(auditUpdate).toBeDefined();
    expect(auditUpdate?.[1]?.[0]).toBe("user-1");
    expect(auditUpdate?.[1]?.[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(auditUpdate?.[0]).toContain(
      "hash_algorithm = 'hmac-sha256-redacted'",
    );
    expect(
      client.query.mock.calls.some(([query]) =>
        query.includes('DELETE FROM "audit_logs"'),
      ),
    ).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});
