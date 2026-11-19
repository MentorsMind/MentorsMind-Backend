jest.mock("../../services/cache.service", () => {
  const values = new Map<string, unknown>();
  return {
    CacheService: {
      get: jest.fn(async (key: string) =>
        values.has(key) ? values.get(key) : null,
      ),
      set: jest.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
      del: jest.fn(async (key: string) => values.delete(key)),
      __values: values,
    },
  };
});
jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../config/metrics", () => ({
  deprecatedApiCallsTotal: { inc: jest.fn() },
}));
jest.mock("../../config/api-versions.config", () => {
  const apiVersions: Record<string, unknown> = {};
  return {
    API_VERSIONS: apiVersions,
    CURRENT_VERSION: "v1",
    SUPPORTED_VERSIONS: ["v1", "v2"],
    SUNSET_WARNING_DAYS: 30,
    isStaticallySunsetExempt: jest.fn().mockReturnValue(false),
    __setVersions(values: Record<string, unknown>) {
      for (const key of Object.keys(apiVersions)) delete apiVersions[key];
      Object.assign(apiVersions, values);
    },
  };
});

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { versioningMiddleware } from "../versioning.middleware";
import {
  SunsetExemptionService,
  sunsetExemptionCacheKey,
} from "../../services/sunset-exemption.service";
import { CacheService } from "../../services/cache.service";
import pool from "../../config/database";
import * as versionsConfig from "../../config/api-versions.config";

const config = versionsConfig as unknown as {
  __setVersions: (values: Record<string, unknown>) => void;
};
const cacheValues = (CacheService as unknown as { __values: Map<string, unknown> })
  .__values;

const runMiddleware = async (userId: string) => {
  const req = {
    path: "/api/v1/users",
    headers: {
      authorization: `Bearer ${jwt.sign({ id: userId }, "test-secret")}`,
    },
    ip: "127.0.0.1",
    get: jest.fn().mockReturnValue("unit-test"),
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn() as NextFunction;

  await versioningMiddleware(req, res as unknown as Response, next);
  return { res, next };
};

describe("versioningMiddleware sunset exemption cache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheValues.clear();
    process.env.JWT_SECRET = "test-secret";
    (pool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 0 });
    config.__setVersions({
      v1: {
        version: "v1",
        active: true,
        deprecatedAt: "2026-01-01T00:00:00Z",
        sunsetAt: "2026-02-01T00:00:00Z",
      },
    });
  });

  test("uses a cached exemption without querying the database", async () => {
    const userId = "cached-user";
    const key = sunsetExemptionCacheKey(userId, "v1");
    cacheValues.set(key, true);

    const { next } = await runMiddleware(userId);

    expect(CacheService.get).toHaveBeenCalledWith(key);
    expect(pool.query).not.toHaveBeenCalled();
    expect(CacheService.set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  test("queries the database on a cache miss and caches the result for five minutes", async () => {
    const userId = "uncached-user";
    const key = sunsetExemptionCacheKey(userId, "v1");
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{}], rowCount: 1 });

    const { next } = await runMiddleware(userId);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(CacheService.set).toHaveBeenCalledWith(key, true, 300);
    expect(next).toHaveBeenCalled();
  });

  test("deletes the cached exemption when revoked", async () => {
    const userId = "revoked-user";
    const key = sunsetExemptionCacheKey(userId, "v1");
    cacheValues.set(key, true);
    (pool.query as jest.Mock).mockResolvedValue({ rows: [], rowCount: 1 });

    await SunsetExemptionService.revoke(userId, "v1");

    expect(CacheService.del).toHaveBeenCalledWith(key);
    expect(cacheValues.has(key)).toBe(false);
  });
});