jest.mock("../../utils/logger.utils", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../../utils/error.utils", () => ({ logWarning: jest.fn(), logInfo: jest.fn(), logError: jest.fn(), addBreadcrumb: jest.fn() }));
import express, { Router } from "express";
import request from "supertest";
import { deprecationMiddleware } from "../deprecation.middleware";
import { initializeDeprecationRegistry } from "../../config/deprecation-registry";
import deprecationManager from "../../utils/deprecation.utils";

afterEach(() => deprecationManager.clearAll());

// Issue #1096: deprecation headers apply only where the middleware is mounted (v1).
it("v1 search/mentors gets headers, v2 does not", async () => {
  initializeDeprecationRegistry();
  const search = Router().get("/mentors", (_req, res) => { res.json({ ok: true }); });
  const v1 = Router().use("/search", deprecationMiddleware, search);
  const v2 = Router().use("/search", search);
  const app = express().use("/api/v1", v1).use("/api/v2", v2);
  const r1 = await request(app).get("/api/v1/search/mentors");
  expect(r1.headers.deprecation).toBe("true");
  expect(r1.headers.sunset).toBeDefined();
  expect(r1.headers.link).toContain("/api/v2/search/mentors");
  const r2 = await request(app).get("/api/v2/search/mentors");
  expect(r2.headers.deprecation).toBeUndefined();
  expect((await request(app).get("/api/v1/search/popular")).headers.deprecation).toBeUndefined();
});

// Sunset must be a fixed date, not recomputed from "now" on every boot.
it("sunset date is stable across re-initialisation and later boots", () => {
  initializeDeprecationRegistry();
  const first = deprecationManager.getDeprecation("GET /api/v1/search/mentors")!.sunsetDate.getTime();
  jest.useFakeTimers().setSystemTime(new Date("2027-01-01T00:00:00Z"));
  try {
    expect(() => initializeDeprecationRegistry()).not.toThrow();
    expect(deprecationManager.getDeprecation("GET /api/v1/search/mentors")!.sunsetDate.getTime()).toBe(first);
  } finally {
    jest.useRealTimers();
  }
});
