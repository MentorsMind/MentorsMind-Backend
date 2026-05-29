/**
 * Unit tests for idempotency middleware.
 *
 * Covers:
 *  - Missing / invalid Idempotency-Key → 400
 *  - Unauthenticated request → 401
 *  - First request: processes normally and persists response
 *  - Duplicate request (same key + user + endpoint): returns cached response
 *  - Expired key: re-processes as fresh
 *  - Same key, different endpoint: 409 Conflict
 */

import { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Mock uuid so tests are deterministic
// ---------------------------------------------------------------------------
jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-a000-000000000000" }));

// ---------------------------------------------------------------------------
// Mock the DB pool
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();
jest.mock("../../config/database", () => ({
  default: { query: mockQuery },
  query: mockQuery,
}));

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { idempotency } from "../idempotency.middleware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_KEY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: { "idempotency-key": VALID_KEY },
    method: "POST",
    path: "/api/v1/payments",
    route: { path: "/api/v1/payments" },
    user: { userId: "user-uuid-1", role: "user" },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): {
  res: Response;
  jsonMock: jest.Mock;
  statusMock: jest.Mock;
} {
  const jsonMock = jest.fn().mockReturnThis();
  const statusMock = jest.fn().mockReturnThis();
  const setHeaderMock = jest.fn();
  const res = {
    json: jsonMock,
    status: statusMock,
    statusCode: 201,
    setHeader: setHeaderMock,
  } as unknown as Response;
  // Make status().json() chain work
  (statusMock as jest.Mock).mockReturnValue(res);
  return { res, jsonMock, statusMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("idempotency middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  it("returns 400 when Idempotency-Key header is missing", async () => {
    const req = makeReq({ headers: {} });
    const { res, statusMock, jsonMock } = makeRes();

    await idempotency(req, res, next);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when Idempotency-Key is not a valid UUID", async () => {
    const req = makeReq({ headers: { "idempotency-key": "not-a-uuid" } });
    const { res, statusMock } = makeRes();

    await idempotency(req, res, next);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when user is not authenticated", async () => {
    const req = makeReq({ user: undefined } as any);
    const { res, statusMock } = makeRes();

    await idempotency(req, res, next);

    expect(statusMock).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("first request: calls next() and intercepts res.json to persist response", async () => {
    // No existing record
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT succeeds
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = makeReq();
    const { res } = makeRes();

    await idempotency(req, res, next);

    expect(next).toHaveBeenCalled();

    // Simulate the handler calling res.json
    (res as any).json({ success: true, data: { id: "123" } });

    // Give the async INSERT a tick to run
    await Promise.resolve();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO idempotency_keys"),
      expect.arrayContaining([VALID_KEY, "user-uuid-1"]),
    );
  });

  it("duplicate request: returns cached response without calling next()", async () => {
    const now = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          endpoint: "POST /api/v1/payments",
          response_body: {
            __status: 201,
            __body: { success: true, data: { id: "123" } },
          },
          created_at: now,
        },
      ],
    });

    const req = makeReq();
    const { res, statusMock, jsonMock } = makeRes();

    await idempotency(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      data: { id: "123" },
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Idempotency-Replayed",
      "true",
    );
  });

  it("expired key: deletes record and calls next() to re-process", async () => {
    const expired = new Date(Date.now() - 25 * 3_600_000); // 25 hours ago
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          endpoint: "POST /api/v1/payments",
          response_body: { __status: 201, __body: {} },
          created_at: expired,
        },
      ],
    });
    // DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = makeReq();
    const { res } = makeRes();

    await idempotency(req, res, next);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM idempotency_keys"),
      expect.arrayContaining([VALID_KEY, "user-uuid-1"]),
    );
    expect(next).toHaveBeenCalled();
  });

  it("same key, different endpoint: returns 409 Conflict", async () => {
    const now = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          endpoint: "POST /api/v1/bookings", // different endpoint
          response_body: { __status: 201, __body: {} },
          created_at: now,
        },
      ],
    });

    const req = makeReq(); // endpoint is POST /api/v1/payments
    const { res, statusMock, jsonMock } = makeRes();

    await idempotency(req, res, next);

    expect(statusMock).toHaveBeenCalledWith(409);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("fails open when DB throws — calls next()", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB down"));

    const req = makeReq();
    const { res } = makeRes();

    await idempotency(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
