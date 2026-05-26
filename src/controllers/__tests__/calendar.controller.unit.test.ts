import { Response } from "express";
import { AuthenticatedRequest } from "../../types/api.types";
import { CalendarController } from "../calendar.controller";

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock("../../services/calendar.service", () => ({
  CalendarService: {
    getICalFeed: jest.fn(),
    getOrCreateICalToken: jest.fn(),
    regenerateICalToken: jest.fn(),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../middleware/errorHandler", () => ({
  createError: (msg: string, code: number) => {
    const e = new Error(msg) as any;
    e.statusCode = code;
    return e;
  },
}));

import { CalendarService } from "../../services/calendar.service";
import { logger } from "../../utils/logger";

const mockService = CalendarService as jest.Mocked<typeof CalendarService>;
const mockLogger = logger as jest.Mocked<typeof logger>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildReq(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  return {
    params: {},
    ip: "192.0.2.1",
    ...overrides,
  } as AuthenticatedRequest;
}

function buildRes(): jest.Mocked<Response> {
  const res: Partial<jest.Mocked<Response>> = {
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
  };
  return res as jest.Mocked<Response>;
}

// ── getICalFeed ────────────────────────────────────────────────────────────────

describe("CalendarController.getICalFeed", () => {
  const token = "a".repeat(64);
  const fakeFeed = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";

  beforeEach(() => {
    mockService.getICalFeed.mockResolvedValue(fakeFeed);
  });

  it("sets Content-Type to text/calendar", async () => {
    const req = buildReq({ params: { token } });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/calendar; charset=utf-8",
    );
  });

  it("sets Cache-Control to private, no-store", async () => {
    const req = buildReq({ params: { token } });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
  });

  it("does NOT set a Cache-Control value that allows shared caching", async () => {
    const req = buildReq({ params: { token } });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    const cacheControlCalls: string[][] = (
      res.setHeader as jest.Mock
    ).mock.calls.filter((args: string[]) => args[0] === "Cache-Control");
    expect(cacheControlCalls.length).toBeGreaterThan(0);
    const cacheValue: string = cacheControlCalls[0][1];
    // Must not contain 'public' directive
    expect(cacheValue).not.toContain("public");
    // Must contain 'private' to explicitly block CDN/proxy caching
    expect(cacheValue).toContain("private");
    // Must contain 'no-store' to prevent any storage of personal data
    expect(cacheValue).toContain("no-store");
  });

  it("sets Content-Disposition to attachment with .ics filename", async () => {
    const req = buildReq({ params: { token } });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="mentorminds.ics"',
    );
  });

  it("sends the feed body from CalendarService.getICalFeed", async () => {
    const req = buildReq({ params: { token } });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    expect(res.send).toHaveBeenCalledWith(fakeFeed);
  });

  it("logs the access with the requesting IP and a token prefix", async () => {
    const req = buildReq({ params: { token }, ip: "203.0.113.42" });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    expect(mockLogger.info).toHaveBeenCalledWith(
      "iCal feed accessed",
      expect.objectContaining({ ip: "203.0.113.42" }),
    );
  });

  it("never logs the full token — only a prefix is recorded", async () => {
    const req = buildReq({ params: { token }, ip: "10.0.0.1" });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    const logCall = (mockLogger.info as jest.Mock).mock.calls[0];
    const loggedMeta = JSON.stringify(logCall);
    expect(loggedMeta).not.toContain(token);
  });

  it("calls CalendarService.getICalFeed with the token from params", async () => {
    const req = buildReq({ params: { token } });
    const res = buildRes();

    await CalendarController.getICalFeed(req, res);

    expect(mockService.getICalFeed).toHaveBeenCalledWith(token);
  });

  it("propagates errors thrown by CalendarService.getICalFeed", async () => {
    mockService.getICalFeed.mockRejectedValueOnce(new Error("Invalid token"));
    const req = buildReq({ params: { token } });
    const res = buildRes();

    await expect(CalendarController.getICalFeed(req, res)).rejects.toThrow(
      "Invalid token",
    );
  });
});

// ── getICalToken ───────────────────────────────────────────────────────────────

describe("CalendarController.getICalToken", () => {
  it("returns the iCal feed URL in the response body", async () => {
    mockService.getOrCreateICalToken.mockResolvedValue("b".repeat(64));
    const req = buildReq({ user: { id: "user-1" } } as any);
    const res = buildRes();

    await CalendarController.getICalToken(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });
});

// ── regenerateICalToken ────────────────────────────────────────────────────────

describe("CalendarController.regenerateICalToken", () => {
  it("returns success with the new feed URL", async () => {
    mockService.regenerateICalToken.mockResolvedValue("c".repeat(64));
    const req = buildReq({ user: { id: "user-1" } } as any);
    const res = buildRes();

    await CalendarController.regenerateICalToken(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        message: expect.stringContaining("regenerated"),
      }),
    );
  });
});
