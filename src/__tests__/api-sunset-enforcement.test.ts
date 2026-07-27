/**
 * API Sunset Enforcement Tests
 *
 * Tests for hard enforcement of API version sunset dates
 */

import { Request, Response, NextFunction } from "express";
import {
  apiSunsetEnforcementMiddleware,
  isSunset,
  isCriticalSunsetPeriod,
  getCriticalSunsetVersions,
  getVersionSunsetStatus,
} from "../middleware/api-sunset-enforcement.middleware";
import { API_VERSIONS } from "../config/api-versions.config";

describe("API Sunset Enforcement Middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn().mockReturnValue(undefined);
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    setHeaderMock = jest.fn();

    mockRes = {
      status: statusMock,
      json: jsonMock,
      setHeader: setHeaderMock,
    };

    mockReq = {
      path: "/api/v1/users",
      headers: {},
      method: "GET",
      ip: "127.0.0.1",
    };

    mockNext = jest.fn();
  });

  describe("Active versions (no sunset)", () => {
    it("should allow requests to active versions without sunset", () => {
      mockReq.path = "/api/v1/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it("should skip non-API routes", () => {
      mockReq.path = "/health";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("Deprecated versions (with sunset dates)", () => {
    beforeEach(() => {
      // Temporarily add a test version with sunset
      API_VERSIONS["test-sunset"] = {
        version: "test-sunset",
        active: true,
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days from now
      };
    });

    afterEach(() => {
      delete API_VERSIONS["test-sunset"];
    });

    it("should add deprecation headers for future sunsets (30+ days)", () => {
      mockReq.path = "/api/test-sunset/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalled();
      expect(setHeaderMock).toHaveBeenCalledWith("X-Deprecation", "true");
      expect(setHeaderMock).toHaveBeenCalledWith(
        "Deprecation",
        expect.any(String)
      );
      expect(setHeaderMock).toHaveBeenCalledWith(
        "Sunset",
        expect.any(String)
      );
    });
  });

  describe("Critical sunset period (0-7 days)", () => {
    beforeEach(() => {
      // Version with sunset in 5 days
      API_VERSIONS["test-critical"] = {
        version: "test-critical",
        active: true,
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      };
    });

    afterEach(() => {
      delete API_VERSIONS["test-critical"];
    });

    it("should return 400 Bad Request for critical period", () => {
      mockReq.path = "/api/test-critical/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          code: "VALIDATION_INVALID_INPUT",
        })
      );
      expect(setHeaderMock).toHaveBeenCalledWith(
        "X-API-Sunset-Critical",
        "true"
      );
      expect(setHeaderMock).toHaveBeenCalledWith("Retry-After", "0");
    });

    it("should include days until sunset in response", () => {
      mockReq.path = "/api/test-critical/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            daysUntilSunset: expect.any(Number),
          }),
        })
      );
    });
  });

  describe("Sunset date passed", () => {
    beforeEach(() => {
      // Version with sunset in the past
      API_VERSIONS["test-sunset-past"] = {
        version: "test-sunset-past",
        active: true, // Still marked active (should be enforced)
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      };
    });

    afterEach(() => {
      delete API_VERSIONS["test-sunset-past"];
    });

    it("should return 410 Gone for sunset dates in past", () => {
      mockReq.path = "/api/test-sunset-past/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(410);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          message: expect.stringContaining("permanently removed"),
        })
      );
    });

    it("should include days overdue in response", () => {
      mockReq.path = "/api/test-sunset-past/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            daysOverdue: expect.any(Number),
          }),
        })
      );
    });
  });

  describe("Helper functions", () => {
    beforeEach(() => {
      // Future sunset
      API_VERSIONS["test-future"] = {
        version: "test-future",
        active: true,
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Critical sunset (3 days)
      API_VERSIONS["test-critical-helper"] = {
        version: "test-critical-helper",
        active: true,
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Sunset passed
      API_VERSIONS["test-past-helper"] = {
        version: "test-past-helper",
        active: true,
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      };
    });

    afterEach(() => {
      delete API_VERSIONS["test-future"];
      delete API_VERSIONS["test-critical-helper"];
      delete API_VERSIONS["test-past-helper"];
    });

    it("should correctly identify sunset versions", () => {
      expect(isSunset("test-future")).toBe(false);
      expect(isSunset("test-critical-helper")).toBe(false);
      expect(isSunset("test-past-helper")).toBe(true);
    });

    it("should correctly identify critical sunset periods", () => {
      expect(isCriticalSunsetPeriod("test-future")).toBe(false);
      expect(isCriticalSunsetPeriod("test-critical-helper")).toBe(true);
      expect(isCriticalSunsetPeriod("test-past-helper")).toBe(true); // Already sunset
    });

    it("should get critical sunset versions", () => {
      const critical = getCriticalSunsetVersions();
      const versionNames = critical.map((v) => v.version);

      expect(versionNames).toContain("test-critical-helper");
      expect(versionNames).toContain("test-past-helper");
      expect(versionNames).not.toContain("test-future");
    });

    it("should get version sunset status", () => {
      const status = getVersionSunsetStatus();

      const future = status.find((v) => v.version === "test-future");
      expect(future?.status).toBe("deprecated");

      const critical = status.find(
        (v) => v.version === "test-critical-helper"
      );
      expect(critical?.status).toBe("critical-warning");

      const past = status.find((v) => v.version === "test-past-helper");
      expect(past?.status).toBe("sunset");
    });
  });

  describe("Accept-Version header support", () => {
    beforeEach(() => {
      API_VERSIONS["test-header"] = {
        version: "test-header",
        active: true,
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
    });

    afterEach(() => {
      delete API_VERSIONS["test-header"];
    });

    it("should enforce sunset on Accept-Version header", () => {
      mockReq.path = "/api/users";
      mockReq.headers = { "accept-version": "test-header" };

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it("should normalize Accept-Version header values", () => {
      mockReq.path = "/api/users";
      mockReq.headers = { "accept-version": "header" }; // without 'v' prefix

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Should normalize to vheader, which doesn't exist, so skip enforcement
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("Edge cases", () => {
    it("should handle invalid ISO dates gracefully", () => {
      API_VERSIONS["test-invalid"] = {
        version: "test-invalid",
        active: true,
        deprecatedAt: "invalid-date",
        sunsetAt: "also-invalid",
      };

      mockReq.path = "/api/test-invalid/users";

      // Should not crash, just continue
      expect(() => {
        apiSunsetEnforcementMiddleware(
          mockReq as Request,
          mockRes as Response,
          mockNext
        );
      }).not.toThrow();

      delete API_VERSIONS["test-invalid"];
    });

    it("should handle inactive versions", () => {
      API_VERSIONS["test-inactive"] = {
        version: "test-inactive",
        active: false,
        deprecatedAt: "2026-06-01T00:00:00Z",
        sunsetAt: "2026-09-01T00:00:00Z",
      };

      mockReq.path = "/api/test-inactive/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(statusMock).toHaveBeenCalledWith(404);

      delete API_VERSIONS["test-inactive"];
    });

    it("should include request ID in error response", () => {
      (mockReq as any).requestId = "req_test_123";

      API_VERSIONS["test-req-id"] = {
        version: "test-req-id",
        active: true,
        sunsetAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      };

      mockReq.path = "/api/test-req-id/users";

      apiSunsetEnforcementMiddleware(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "req_test_123",
        })
      );

      delete API_VERSIONS["test-req-id"];
    });
  });
});
