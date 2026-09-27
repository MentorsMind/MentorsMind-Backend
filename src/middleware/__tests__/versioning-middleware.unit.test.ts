/**
 * Unit tests for versioning.middleware
 *
 * Coverage targets
 * ─────────────────────────────────────────────────────────────────────────────
 * • Deprecation headers (Deprecation, Sunset, X-API-Deprecation-Date,
 *   X-API-Sunset-Date, X-Deprecation-Message, Link)
 * • Warning: 299 header when within SUNSET_WARNING_DAYS of sunset
 * • Warning: 299 header is NOT present outside the warning window
 * • 410 Gone is returned when sunsetAt has passed
 * • Sunset exemption bypasses the 410 and adds X-Sunset-Exemption: active
 * • Non-deprecated version → no deprecation/warning headers
 * • Unknown / inactive version → 404
 * • Accept-Version header resolution
 * • X-API-Version is always set
 */

// ─── Mocks (must precede all imports) ────────────────────────────────────────

jest.mock("../../services/sunset-exemption.service", () => ({
  SunsetExemptionService: { isExempt: jest.fn().mockResolvedValue(false) },
}));

jest.mock("../../config/metrics", () => ({
  deprecatedApiCallsTotal: { inc: jest.fn() },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config/api-versions.config", () => {
  // Mutable store so individual tests can install the version state under test.
  const apiVersions: Record<string, unknown> = {};
  return {
    API_VERSIONS: apiVersions,
    __setVersions(values: Record<string, unknown>) {
      for (const key of Object.keys(apiVersions)) delete apiVersions[key];
      Object.assign(apiVersions, values);
    },
    CURRENT_VERSION: "v1",
    SUPPORTED_VERSIONS: ["v1", "v2"],
    SUNSET_WARNING_DAYS: 30,
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from "express";
import { versioningMiddleware } from "../versioning.middleware";
import { SunsetExemptionService } from "../../services/sunset-exemption.service";
import * as versionsConfig from "../../config/api-versions.config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { deprecatedApiCallsTotal } = jest.requireMock("../../config/metrics") as any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const config = versionsConfig as unknown as {
  __setVersions: (values: Record<string, unknown>) => void;
};

interface RunResult {
  res: {
    status: jest.Mock;
    setHeader: jest.Mock;
    json: jest.Mock;
  };
  next: jest.Mock;
}

/**
 * Invoke the middleware with a fake request.
 *
 * @param path    URL path (defaults to "/api/v1/users")
 * @param headers Additional request headers
 */
const runMiddleware = async (
  path = "/api/v1/users",
  headers: Record<string, string> = {},
): Promise<RunResult> => {
  const req = {
    path,
    headers,
    ip: "127.0.0.1",
    // Express req.get() looks up a header by name
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const next = jest.fn() as jest.Mock;
  await versioningMiddleware(req, res as unknown as Response, next as NextFunction);
  return { res, next };
};

// ─── Convenience version fixtures ─────────────────────────────────────────────

const DEPRECATED_AT = "2026-01-01T00:00:00Z";

/** A version that is already past its sunset date (in the past relative to the faked clock). */
const sunsetVersion = (extra: Record<string, unknown> = {}) => ({
  v1: {
    version: "v1",
    active: true,
    deprecatedAt: DEPRECATED_AT,
    sunsetAt: "2026-02-01T00:00:00Z",   // in the past (fake clock = 2026-09-27)
    successorVersion: "v2",
    migrationGuide: "https://docs.mentorminds.com/api/migration/v1-to-v2",
    ...extra,
  },
  v2: { version: "v2", active: true },
});

/** A version whose sunset is 10 days away (inside the 30-day window). */
const warningWindowVersion = (daysAway = 10) => {
  const sunsetAt = new Date(Date.now() + daysAway * 24 * 60 * 60 * 1000).toISOString();
  return {
    v1: {
      version: "v1",
      active: true,
      deprecatedAt: DEPRECATED_AT,
      sunsetAt,
    },
    v2: { version: "v2", active: true },
  };
};

/** A version whose sunset is 90 days away (outside the 30-day window). */
const farSunsetVersion = () => {
  const sunsetAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  return {
    v1: {
      version: "v1",
      active: true,
      deprecatedAt: DEPRECATED_AT,
      sunsetAt,
    },
    v2: { version: "v2", active: true },
  };
};

// =============================================================================
// Test suites
// =============================================================================

describe("versioningMiddleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset exemption service default to "not exempt"
    (SunsetExemptionService.isExempt as jest.Mock).mockResolvedValue(false);
  });

  // ── X-API-Version always set ──────────────────────────────────────────────

  describe("X-API-Version header", () => {
    it("is always set for known active versions", async () => {
      config.__setVersions({ v1: { version: "v1", active: true } });

      const { res } = await runMiddleware();

      expect(res.setHeader).toHaveBeenCalledWith("X-API-Version", "v1");
    });
  });

  // ── Unknown / inactive version → 404 ─────────────────────────────────────

  describe("unknown or inactive version", () => {
    it("returns 404 for an unknown version in the URL", async () => {
      config.__setVersions({ v2: { version: "v2", active: true } });

      // Path resolves to v1, which is not in the version map
      const { res, next } = await runMiddleware("/api/v1/users");

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("returns 404 for an inactive version", async () => {
      config.__setVersions({
        v1: { version: "v1", active: false },
        v2: { version: "v2", active: true },
      });

      const { res, next } = await runMiddleware("/api/v1/users");

      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Non-deprecated version ────────────────────────────────────────────────

  describe("non-deprecated version", () => {
    it("calls next() without attaching any deprecation or warning headers", async () => {
      config.__setVersions({ v1: { version: "v1", active: true } });

      const { res, next } = await runMiddleware();

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalledWith("Deprecation", expect.anything());
      expect(res.setHeader).not.toHaveBeenCalledWith("Sunset", expect.anything());
      expect(res.setHeader).not.toHaveBeenCalledWith("X-API-Deprecation-Date", expect.anything());
      expect(res.setHeader).not.toHaveBeenCalledWith("X-API-Sunset-Date", expect.anything());
      expect(res.setHeader).not.toHaveBeenCalledWith("Warning", expect.anything());
    });

    it("does not increment deprecated_api_calls_total for non-deprecated versions", async () => {
      config.__setVersions({ v1: { version: "v1", active: true } });

      await runMiddleware();

      expect(deprecatedApiCallsTotal.inc).not.toHaveBeenCalled();
    });
  });

  // ── Deprecation headers ───────────────────────────────────────────────────

  describe("deprecation headers", () => {
    it("sets Deprecation and X-API-Deprecation-Date when deprecatedAt is present", async () => {
      config.__setVersions(farSunsetVersion());

      const { res } = await runMiddleware();

      expect(res.setHeader).toHaveBeenCalledWith("Deprecation", DEPRECATED_AT);
      expect(res.setHeader).toHaveBeenCalledWith("X-API-Deprecation-Date", DEPRECATED_AT);
    });

    it("sets Sunset and X-API-Sunset-Date when sunsetAt is present", async () => {
      const versions = farSunsetVersion();
      config.__setVersions(versions);
      const sunsetAt = (versions.v1 as { sunsetAt: string }).sunsetAt;

      const { res } = await runMiddleware();

      expect(res.setHeader).toHaveBeenCalledWith("Sunset", sunsetAt);
      expect(res.setHeader).toHaveBeenCalledWith("X-API-Sunset-Date", sunsetAt);
    });

    it("sets X-Deprecation-Message when deprecationMessage is provided", async () => {
      const versions = farSunsetVersion();
      (versions.v1 as Record<string, unknown>).deprecationMessage =
        "v1 is deprecated; migrate to v2.";
      config.__setVersions(versions);

      const { res } = await runMiddleware();

      expect(res.setHeader).toHaveBeenCalledWith(
        "X-Deprecation-Message",
        "v1 is deprecated; migrate to v2.",
      );
    });

    it("sets Link header with successor-version relation when migrationGuide is provided", async () => {
      const versions = farSunsetVersion();
      (versions.v1 as Record<string, unknown>).migrationGuide =
        "https://docs.mentorminds.com/api/migration/v1-to-v2";
      config.__setVersions(versions);

      const { res } = await runMiddleware();

      expect(res.setHeader).toHaveBeenCalledWith(
        "Link",
        `<https://docs.mentorminds.com/api/migration/v1-to-v2>; rel="successor-version"`,
      );
    });

    it("increments deprecated_api_calls_total counter for deprecated versions", async () => {
      config.__setVersions(farSunsetVersion());

      await runMiddleware();

      expect(deprecatedApiCallsTotal.inc).toHaveBeenCalledWith({ version: "v1" });
    });

    it("does not set Sunset or X-API-Sunset-Date when sunsetAt is absent", async () => {
      config.__setVersions({
        v1: {
          version: "v1",
          active: true,
          deprecatedAt: DEPRECATED_AT,
          // no sunsetAt
        },
      });

      const { res } = await runMiddleware();

      expect(res.setHeader).not.toHaveBeenCalledWith("Sunset", expect.anything());
      expect(res.setHeader).not.toHaveBeenCalledWith("X-API-Sunset-Date", expect.anything());
    });
  });

  // ── Warning: 299 window ───────────────────────────────────────────────────

  describe("Warning: 299 header — sunset warning window", () => {
    it("adds Warning: 299 header when 1 day before sunset (inside 30-day window)", async () => {
      jest.useFakeTimers();
      try {
        // Anchor: 2026-09-01T00:00:00Z
        const now = new Date("2026-09-01T00:00:00Z").getTime();
        jest.setSystemTime(now);

        // Sunset is 1 day away
        const sunsetAt = new Date(now + 1 * 24 * 60 * 60 * 1000).toISOString();
        config.__setVersions({
          v1: {
            version: "v1",
            active: true,
            deprecatedAt: DEPRECATED_AT,
            sunsetAt,
          },
          v2: { version: "v2", active: true },
        });

        const { res, next } = await runMiddleware();

        expect(res.status).not.toHaveBeenCalledWith(410);
        expect(res.setHeader).toHaveBeenCalledWith(
          "Warning",
          `299 - "This API version will be sunset on ${sunsetAt}"`,
        );
        expect(next).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("adds Warning: 299 header when exactly 30 days before sunset (boundary)", async () => {
      jest.useFakeTimers();
      try {
        const now = new Date("2026-09-01T00:00:00Z").getTime();
        jest.setSystemTime(now);

        // Exactly 30 days away → Math.ceil(30 * DAY_MS / DAY_MS) = 30
        const sunsetAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
        config.__setVersions({
          v1: {
            version: "v1",
            active: true,
            deprecatedAt: DEPRECATED_AT,
            sunsetAt,
          },
          v2: { version: "v2", active: true },
        });

        const { res } = await runMiddleware();

        expect(res.setHeader).toHaveBeenCalledWith(
          "Warning",
          `299 - "This API version will be sunset on ${sunsetAt}"`,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("does NOT add Warning: 299 header when 31 days before sunset (outside window)", async () => {
      jest.useFakeTimers();
      try {
        const now = new Date("2026-09-01T00:00:00Z").getTime();
        jest.setSystemTime(now);

        // 31 days away → outside the 30-day window
        const sunsetAt = new Date(now + 31 * 24 * 60 * 60 * 1000).toISOString();
        config.__setVersions({
          v1: {
            version: "v1",
            active: true,
            deprecatedAt: DEPRECATED_AT,
            sunsetAt,
          },
          v2: { version: "v2", active: true },
        });

        const { res } = await runMiddleware();

        expect(res.setHeader).not.toHaveBeenCalledWith(
          "Warning",
          expect.any(String),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("does NOT add Warning: 299 header when 90 days before sunset", async () => {
      config.__setVersions(farSunsetVersion());

      const { res } = await runMiddleware();

      expect(res.setHeader).not.toHaveBeenCalledWith(
        "Warning",
        expect.any(String),
      );
    });
  });

  // ── 410 Gone — sunset enforcement ────────────────────────────────────────

  describe("410 Gone — sunset enforcement", () => {
    it("returns 410 with API_VERSION_SUNSET body when sunsetAt has passed", async () => {
      jest.useFakeTimers();
      try {
        // Set fake clock to well after the sunset date
        jest.setSystemTime(new Date("2026-09-27T00:00:00Z").getTime());

        config.__setVersions(sunsetVersion());

        const { res, next } = await runMiddleware();

        expect(res.status).toHaveBeenCalledWith(410);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            code: "API_VERSION_SUNSET",
            // message uses the raw sunsetAt string from versionConfig, not a re-formatted Date
            message: expect.stringContaining("sunset on 2026-02-01T00:00:00Z"),
            migrationGuide: "https://docs.mentorminds.com/api/migration/v1-to-v2",
          }),
        );
        expect(next).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("includes the successor version in the 410 message", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-09-27T00:00:00Z").getTime());
        config.__setVersions(sunsetVersion({ successorVersion: "v2" }));

        const { res } = await runMiddleware();

        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining("migrate to v2"),
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("still increments deprecated_api_calls_total before returning 410", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-09-27T00:00:00Z").getTime());
        config.__setVersions(sunsetVersion());

        await runMiddleware();

        expect(deprecatedApiCallsTotal.inc).toHaveBeenCalledWith({ version: "v1" });
      } finally {
        jest.useRealTimers();
      }
    });

    it("does NOT return 410 for a version with no sunsetAt", async () => {
      config.__setVersions({
        v1: {
          version: "v1",
          active: true,
          deprecatedAt: DEPRECATED_AT,
          // no sunsetAt
        },
      });

      const { res, next } = await runMiddleware();

      expect(res.status).not.toHaveBeenCalledWith(410);
      expect(next).toHaveBeenCalled();
    });
  });

  // ── Sunset exemption ──────────────────────────────────────────────────────

  describe("sunset exemption", () => {
    it("bypasses 410 and sets X-Sunset-Exemption: active for an exempt caller", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-09-27T00:00:00Z").getTime());
        (SunsetExemptionService.isExempt as jest.Mock).mockResolvedValueOnce(true);
        config.__setVersions(sunsetVersion());

        const { res, next } = await runMiddleware("/api/v1/users", {
          authorization: "Bearer valid-token",
        });

        expect(res.status).not.toHaveBeenCalledWith(410);
        expect(res.setHeader).toHaveBeenCalledWith("X-Sunset-Exemption", "active");
        expect(next).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("calls SunsetExemptionService.isExempt with the resolved version", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-09-27T00:00:00Z").getTime());
        (SunsetExemptionService.isExempt as jest.Mock).mockResolvedValueOnce(true);
        config.__setVersions(sunsetVersion());

        await runMiddleware();

        expect(SunsetExemptionService.isExempt).toHaveBeenCalledWith(
          // userId is undefined for anonymous callers (no Authorization header)
          undefined,
          "v1",
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("still returns 410 when isExempt returns false", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-09-27T00:00:00Z").getTime());
        (SunsetExemptionService.isExempt as jest.Mock).mockResolvedValueOnce(false);
        config.__setVersions(sunsetVersion());

        const { res, next } = await runMiddleware();

        expect(res.status).toHaveBeenCalledWith(410);
        expect(next).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it("still returns 410 when isExempt throws (exemption check failure)", async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date("2026-09-27T00:00:00Z").getTime());
        (SunsetExemptionService.isExempt as jest.Mock).mockRejectedValueOnce(
          new Error("DB unavailable"),
        );
        config.__setVersions(sunsetVersion());

        const { res, next } = await runMiddleware();

        expect(res.status).toHaveBeenCalledWith(410);
        expect(next).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ── Accept-Version header resolution ─────────────────────────────────────

  describe("Accept-Version header resolution", () => {
    it("resolves the version from Accept-Version header when no URL version is present", async () => {
      config.__setVersions({ v2: { version: "v2", active: true } });

      const { res, next } = await runMiddleware("/api/users", {
        "accept-version": "v2",
      });

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith("X-API-Version", "v2");
    });

    it("normalises Accept-Version without a leading 'v'", async () => {
      config.__setVersions({ v2: { version: "v2", active: true } });

      const { res, next } = await runMiddleware("/api/users", {
        "accept-version": "2",
      });

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith("X-API-Version", "v2");
    });

    it("gives URL version priority over Accept-Version header", async () => {
      config.__setVersions({
        v1: { version: "v1", active: true },
        v2: { version: "v2", active: true },
      });

      // URL says v1, header says v2 → v1 should win
      const { res } = await runMiddleware("/api/v1/users", {
        "accept-version": "v2",
      });

      expect(res.setHeader).toHaveBeenCalledWith("X-API-Version", "v1");
    });

    it("falls back to CURRENT_VERSION when no URL segment and no Accept-Version header", async () => {
      config.__setVersions({ v1: { version: "v1", active: true } });

      const { res, next } = await runMiddleware("/api/users");

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith("X-API-Version", "v1");
    });
  });

  // ── X-Supported-Versions header ───────────────────────────────────────────

  describe("X-Supported-Versions header", () => {
    it("is set when the middleware passes through to next()", async () => {
      config.__setVersions({ v1: { version: "v1", active: true } });

      const { res } = await runMiddleware();

      expect(res.setHeader).toHaveBeenCalledWith(
        "X-Supported-Versions",
        "v1, v2",
      );
    });
  });
});
