import HealthService from "../health.service";
import { redis } from "../../config/redis";
import { db } from "../../config/database";

jest.mock("../../config/redis", () => ({
  redis: {
    ping: jest.fn(),
  },
}));

jest.mock("../../config/database", () => ({
  db: {
    query: jest.fn().mockResolvedValue({ rows: [{ count: "0", retrying: "0" }] }),
  },
}));

jest.mock("../../config/stellar", () => ({
  server: {
    ledgers: () => ({
      limit: () => ({
        call: jest.fn().mockResolvedValue({}),
      }),
    }),
  },
}));

jest.mock("../../queues/email.queue", () => ({
  emailQueue: {
    getJobCounts: jest.fn().mockResolvedValue({ active: 0, waiting: 0, completed: 0, failed: 0 }),
  },
}));

jest.mock("../../utils/table-validator.utils", () => ({
  validateRequiredTables: jest.fn().mockResolvedValue({ allTablesExist: true, totalTables: 10, missingTables: [] }),
}));

jest.mock("../jwks.service", () => ({
  JwksService: {
    getRotationStatus: jest.fn().mockResolvedValue({ activeKeyId: "key-1" }),
    getCurrentKey: jest.fn().mockResolvedValue({ kid: "key-1" }),
  },
}));

describe("HealthService Unit Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (HealthService as any).readinessCache = null;
  });

  it("getDetailedHealth includes healthy redis component when redis.ping succeeds", async () => {
    (redis.ping as jest.Mock).mockResolvedValueOnce("PONG");

    const health = await HealthService.getDetailedHealth();

    expect(health.components.redis).toBeDefined();
    expect(health.components.redis.status).toBe("healthy");
    expect(typeof health.components.redis.responseTimeMs).toBe("number");
  });

  it("getDetailedHealth includes unhealthy redis component and overall status is degraded when redis.ping fails", async () => {
    (redis.ping as jest.Mock).mockRejectedValueOnce(new Error("Connection refused"));

    const health = await HealthService.getDetailedHealth();

    expect(health.components.redis).toBeDefined();
    expect(health.components.redis.status).toBe("unhealthy");
    expect(health.components.redis.error).toBe("Connection refused");
    // Overall status must be degraded (not unhealthy), so health check returns 200
    expect(health.status).toBe("degraded");
  });
});
