const mockPoolQuery = jest.fn();

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

jest.mock("../../services/socket.service", () => ({
  SocketService: { emitToUser: jest.fn() },
}));

jest.mock("../../models", () => ({
  NotificationsModel: {},
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { Request, Response } from "express";
import { NotificationsController } from "../notifications.controller";
import { listNotificationsSchema } from "../../validators/schemas/notifications.schemas";

const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TOTAL_NOTIFICATIONS = 45;

function mockReq(query: Record<string, string> = {}): Request {
  return { user: { id: USER_ID, userId: USER_ID, role: "mentee" }, query } as unknown as Request;
}

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

async function getNotifications(query: Record<string, string> = {}) {
  const res = mockRes();
  NotificationsController.getNotifications(mockReq(query), res, jest.fn());
  await new Promise((r) => setImmediate(r));
  return (res.json as jest.Mock).mock.calls[0][0];
}

function listQueryParams(): unknown[] {
  const listCall = mockPoolQuery.mock.calls.find(([sql]) => /LIMIT \$2 OFFSET \$3/.test(sql));
  return listCall[1];
}

describe("GET /api/v1/notifications pagination", () => {
  beforeEach(() => {
    mockPoolQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ count: String(TOTAL_NOTIFICATIONS) }] };
      }
      const [, limit, offset] = params as [string, number, number];
      const remaining = Math.max(0, Math.min(limit, TOTAL_NOTIFICATIONS - offset));
      return {
        rows: Array.from({ length: remaining }, (_, i) => ({ id: `notification-${offset + i + 1}` })),
      };
    });
  });

  it("defaults to page 1 with 20 notifications per page", async () => {
    const body = await getNotifications();

    expect(listQueryParams()).toEqual([USER_ID, 20, 0]);
    expect(body.data.notifications).toHaveLength(20);
    expect(body.meta).toEqual({
      page: 1,
      limit: 20,
      total: TOTAL_NOTIFICATIONS,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
    });
  });

  it("returns the second page of results", async () => {
    const body = await getNotifications({ page: "2", limit: "20" });

    expect(listQueryParams()).toEqual([USER_ID, 20, 20]);
    expect(body.data.notifications[0].id).toBe("notification-21");
    expect(body.meta).toEqual(
      expect.objectContaining({ page: 2, total: TOTAL_NOTIFICATIONS, totalPages: 3, hasNext: true }),
    );
  });

  it("caps limit at 50", async () => {
    const body = await getNotifications({ limit: "100" });

    expect(listQueryParams()).toEqual([USER_ID, 50, 0]);
    expect(body.meta).toEqual(
      expect.objectContaining({ page: 1, limit: 50, totalPages: 1, hasNext: false }),
    );
  });
});

describe("listNotificationsSchema", () => {
  it("defaults page to 1 and limit to 20", () => {
    const parsed = listNotificationsSchema.parse({ query: {} });

    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it("accepts a limit of 50 and rejects anything above it", () => {
    expect(listNotificationsSchema.safeParse({ query: { limit: "50" } }).success).toBe(true);
    expect(listNotificationsSchema.safeParse({ query: { limit: "51" } }).success).toBe(false);
  });
});
