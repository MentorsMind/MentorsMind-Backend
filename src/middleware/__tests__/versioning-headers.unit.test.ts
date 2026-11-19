jest.mock("../../services/sunset-exemption.service", () => ({
  SunsetExemptionService: { isExempt: jest.fn().mockResolvedValue(true) },
  sunsetExemptionCacheKey: jest.fn(() => "sunset:exempt:user-1:v1"),
}));
jest.mock("../../services/cache.service", () => ({
  CacheService: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
  },
}));
jest.mock("../../config/metrics", () => ({
  deprecatedApiCallsTotal: { inc: jest.fn() },
}));
jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../config/api-versions.config", () => ({
  API_VERSIONS: {
    v1: {
      version: "v1",
      active: true,
      sunsetAt: "2000-01-01T00:00:00Z",
    },
  },
  CURRENT_VERSION: "v1",
  SUPPORTED_VERSIONS: ["v1", "v2"],
  SUNSET_WARNING_DAYS: 30,
}));

import { Request, Response, NextFunction } from "express";
import { versioningMiddleware } from "../versioning.middleware";

describe("versioningMiddleware response headers", () => {
  test("sets X-Supported-Versions exactly once for an exempt sunset request", async () => {
    const headers = new Map<string, string>();
    const setHeader = jest.fn((name: string, value: string) => {
      headers.set(name, value);
    });
    const res = {
      setHeader,
      getHeader: jest.fn((name: string) => headers.get(name)),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const req = {
      path: "/api/v1/users",
      headers: {},
      user: { id: "user-1" },
      get: jest.fn(),
    } as unknown as Request;
    const next = jest.fn() as NextFunction;

    await versioningMiddleware(req, res as unknown as Response, next);

    expect(
      setHeader.mock.calls.filter(([name]) => name === "X-Supported-Versions"),
    ).toHaveLength(1);
    expect(res.getHeader("X-Supported-Versions")).toBe("v1, v2");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
