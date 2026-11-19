import { authenticate, AuthenticatedRequest } from "../../../src/middleware/auth.middleware";
import { CacheService } from "../../../src/services/cache.service";
import pool from "../../../src/config/database";
import jwt from "jsonwebtoken";
import { Response, NextFunction } from "express";

jest.mock("jsonwebtoken");
jest.mock("../../../src/middleware/tracing.middleware", () => ({
  traceStore: { getStore: jest.fn() },
}));
jest.mock("../../../src/middleware/errorHandler", () => ({
  createError: (code: string, statusCode: number, details?: object) =>
    Object.assign(new Error(code), {
      code,
      statusCode,
      isOperational: true,
      details,
    }),
}));
jest.mock("../../../src/utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../../src/config/database", () => ({
  __esModule: true,
  default: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

jest.mock("../../../src/services/cache.service", () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
    isDistributed: jest.fn(),
    invalidatePattern: jest.fn(),
  },
}));

jest.mock("../../../src/config/env", () => ({
  env: { JWT_SECRET: "test-secret" },
}));

describe("authenticated token revocation cache", () => {
  const databaseQuery = pool.query as jest.Mock;
  const cacheGet = CacheService.get as jest.Mock;
  const cacheSet = CacheService.set as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    databaseQuery.mockResolvedValue({
      rows: [
        {
          token_invalid_before: null,
          deletion_completed_at: null,
          token_blacklisted: false,
        },
      ],
    });
    cacheGet.mockResolvedValueOnce(null).mockResolvedValueOnce(false);
    cacheSet.mockResolvedValue(undefined);
    (CacheService.isDistributed as jest.Mock).mockReturnValue(true);
    (jwt.decode as jest.Mock).mockReturnValue({ header: { alg: "HS256" } });
    (jwt.verify as jest.Mock).mockReturnValue({
      sub: "cache-test-user",
      role: "learner",
      iat: 1_790_000_000,
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: "cache-test-jti",
    });
  });

  it("caches the first revocation check and skips the DB query on the next request", async () => {
    const request = (): Partial<AuthenticatedRequest> => ({
      headers: { authorization: "Bearer valid-token" },
    });
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    await authenticate(request() as AuthenticatedRequest, response, next);
    await authenticate(request() as AuthenticatedRequest, response, next);

    expect(cacheSet).toHaveBeenCalledWith(
      "token:revoked:cache-test-user:cache-test-jti",
      false,
      300,
    );
    expect(databaseQuery.mock.calls.filter(([query]) =>
      String(query).includes("token_invalid_before"),
    )).toHaveLength(1);
    expect(cacheGet).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
