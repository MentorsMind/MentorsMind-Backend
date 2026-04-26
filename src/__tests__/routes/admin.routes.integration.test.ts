import request from "supertest";

jest.mock("../../middleware/auth.middleware", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: "admin-user-id", userId: "admin-user-id", role: "admin" };
    next();
  },
}));

jest.mock("../../middleware/admin-auth.middleware", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../middleware/ipFilter.middleware", () => ({
  blocklistMiddleware: (_req: any, _res: any, next: any) => next(),
  adminAllowlistMiddleware: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../jobs/refreshAnalytics.job", () => ({
  refreshAnalyticsJob: {
    initialize: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../../services/admin.service", () => ({
  AdminService: {
    getStats: jest.fn(),
    listUsers: jest.fn(),
    updateUserStatus: jest.fn(),
    listTransactions: jest.fn(),
    listSessions: jest.fn(),
    listPayments: jest.fn(),
    listDisputes: jest.fn(),
    resolveDispute: jest.fn(),
    getSystemHealth: jest.fn(),
    getLogs: jest.fn(),
    updateConfig: jest.fn(),
  },
}));

import app from "../../app";
import { AdminService } from "../../services/admin.service";

const API_BASE = "/api/v1/admin";
const mockedAdminService = AdminService as jest.Mocked<typeof AdminService>;

describe("Admin list endpoints integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /admin/users", () => {
    it("returns users without optional filter params", async () => {
      mockedAdminService.listUsers.mockResolvedValue({
        data: [{ id: "u-1", role: "mentor" } as any],
        total: 1,
      });

      const response = await request(app).get(`${API_BASE}/users`);

      expect(response.status).toBe(200);
      expect(mockedAdminService.listUsers).toHaveBeenCalledWith(50, 0, undefined);
      expect(response.body.status).toBe("success");
      expect(response.body.data).toEqual([{ id: "u-1", role: "mentor" }]);
      expect(response.body.meta).toMatchObject({ total: 1, limit: 50, offset: 0 });
    });

    it("returns users with role filter params", async () => {
      mockedAdminService.listUsers.mockResolvedValue({
        data: [{ id: "u-2", role: "admin" } as any],
        total: 1,
      });

      const response = await request(app)
        .get(`${API_BASE}/users`)
        .query({ limit: 10, offset: 5, role: "admin" });

      expect(response.status).toBe(200);
      expect(mockedAdminService.listUsers).toHaveBeenCalledWith(10, 5, "admin");
      expect(response.body.status).toBe("success");
      expect(response.body.data).toEqual([{ id: "u-2", role: "admin" }]);
      expect(response.body.meta).toMatchObject({ total: 1, limit: 10, offset: 5 });
    });
  });

  describe("GET /admin/sessions", () => {
    it("returns sessions without optional filter params", async () => {
      mockedAdminService.listSessions.mockResolvedValue({
        data: [{ id: "s-1", status: "scheduled" }],
        total: 1,
      });

      const response = await request(app).get(`${API_BASE}/sessions`);

      expect(response.status).toBe(200);
      expect(mockedAdminService.listSessions).toHaveBeenCalledWith(
        50,
        0,
        undefined,
      );
      expect(response.body.status).toBe("success");
      expect(response.body.data).toEqual([{ id: "s-1", status: "scheduled" }]);
      expect(response.body.meta).toMatchObject({ total: 1, limit: 50, offset: 0 });
    });

    it("returns sessions with status filter params", async () => {
      mockedAdminService.listSessions.mockResolvedValue({
        data: [{ id: "s-2", status: "completed" }],
        total: 1,
      });

      const response = await request(app)
        .get(`${API_BASE}/sessions`)
        .query({ limit: 25, offset: 10, status: "completed" });

      expect(response.status).toBe(200);
      expect(mockedAdminService.listSessions).toHaveBeenCalledWith(
        25,
        10,
        "completed",
      );
      expect(response.body.status).toBe("success");
      expect(response.body.data).toEqual([{ id: "s-2", status: "completed" }]);
      expect(response.body.meta).toMatchObject({ total: 1, limit: 25, offset: 10 });
    });
  });

  describe("GET /admin/payments", () => {
    it("returns payments without optional filter params", async () => {
      mockedAdminService.listPayments.mockResolvedValue({
        data: [{ id: "p-1", type: "payment" } as any],
        total: 1,
      });

      const response = await request(app).get(`${API_BASE}/payments`);

      expect(response.status).toBe(200);
      expect(mockedAdminService.listPayments).toHaveBeenCalledWith(
        50,
        0,
        undefined,
        undefined,
      );
      expect(response.body.status).toBe("success");
      expect(response.body.data).toEqual([{ id: "p-1", type: "payment" }]);
      expect(response.body.meta).toMatchObject({ total: 1, limit: 50, offset: 0 });
    });

    it("returns payments with date range filter params", async () => {
      mockedAdminService.listPayments.mockResolvedValue({
        data: [{ id: "p-2", type: "mentor_payout" } as any],
        total: 1,
      });

      const response = await request(app)
        .get(`${API_BASE}/payments`)
        .query({
          limit: 20,
          offset: 2,
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        });

      expect(response.status).toBe(200);
      expect(mockedAdminService.listPayments).toHaveBeenCalledWith(
        20,
        2,
        "2026-01-01",
        "2026-01-31",
      );
      expect(response.body.status).toBe("success");
      expect(response.body.data).toEqual([{ id: "p-2", type: "mentor_payout" }]);
      expect(response.body.meta).toMatchObject({ total: 1, limit: 20, offset: 2 });
    });
  });
});
