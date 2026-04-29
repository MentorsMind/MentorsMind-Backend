jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

jest.mock("../../config/stellar", () => ({
  server: {
    ledgers: jest.fn(),
  },
}));

jest.mock("../../config", () => ({
  __esModule: true,
  default: {
    server: {
      apiVersion: "v1",
    },
  },
}));

jest.mock("../../config/redis.config", () => ({
  redisConfig: {
    url: "redis://localhost:6379",
  },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    isDistributed: jest.fn(),
    ping: jest.fn(),
  },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../../utils/table-validator.utils", () => ({
  validateRequiredTables: jest.fn(),
}));

import HealthService, {
  DetailedHealthStatus,
  HealthStatus,
} from "../health.service";

const createStatus = (
  status: HealthStatus,
  error?: string,
): DetailedHealthStatus => ({
  status,
  components: {
    db: { status, error },
    redis: { status: "healthy" },
    horizon: { status: "healthy" },
    queues: { status: "healthy", details: { active: 0 } },
    system: { status: "healthy" },
  },
  uptime: 1,
  version: "v1",
  timestamp: new Date(0).toISOString(),
});

describe("HealthService readiness cache", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (HealthService as any).readinessCache = null;
  });

  it("keeps healthy readiness results cached for 5 seconds", async () => {
    const performFullCheck = jest
      .spyOn(HealthService as any, "performFullCheck")
      .mockResolvedValue(createStatus("healthy"));

    jest.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(5999);

    await HealthService.checkReadiness();
    await HealthService.checkReadiness();

    expect(performFullCheck).toHaveBeenCalledTimes(1);
    expect((HealthService as any).readinessCache.lastError).toBeNull();
  });

  it("expires unhealthy readiness results after 1 second and stores lastError", async () => {
    const unhealthy = createStatus("unhealthy", "database unavailable");
    const healthy = createStatus("healthy");
    const performFullCheck = jest
      .spyOn(HealthService as any, "performFullCheck")
      .mockResolvedValueOnce(unhealthy)
      .mockResolvedValueOnce(healthy);

    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1999)
      .mockReturnValueOnce(2001);

    const first = await HealthService.checkReadiness();
    expect((HealthService as any).readinessCache.lastError).toBe(
      "db: database unavailable",
    );

    const cached = await HealthService.checkReadiness();
    const refreshed = await HealthService.checkReadiness();

    expect(first.status).toBe("unhealthy");
    expect(cached).toBe(first);
    expect(refreshed.status).toBe("healthy");
    expect(performFullCheck).toHaveBeenCalledTimes(2);
    expect((HealthService as any).readinessCache.lastError).toBeNull();
  });

  it("does not cache readiness results when the full check throws", async () => {
    const cachedHealthy = createStatus("healthy");
    const recoveredHealthy = createStatus("healthy");
    const performFullCheck = jest
      .spyOn(HealthService as any, "performFullCheck")
      .mockResolvedValueOnce(cachedHealthy)
      .mockRejectedValueOnce(new Error("redis check crashed"))
      .mockResolvedValueOnce(recoveredHealthy);

    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(7000)
      .mockReturnValueOnce(7001);

    await HealthService.checkReadiness();
    const thrownResult = await HealthService.checkReadiness();
    const afterThrow = await HealthService.checkReadiness();

    expect(thrownResult.status).toBe("unhealthy");
    expect(thrownResult.components.redis.error).toBe("redis check crashed");
    expect(afterThrow.status).toBe("healthy");
    expect(performFullCheck).toHaveBeenCalledTimes(3);
  });
});
