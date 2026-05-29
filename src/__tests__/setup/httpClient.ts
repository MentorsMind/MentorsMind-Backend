/**
 * Pre-configured supertest agent for integration tests.
 *
 * The app is loaded lazily (via require) so that all env vars written by
 * globalSetup — including DATABASE_URL and REDIS_URL pointing at the test
 * containers — are in place before any app module is imported.
 *
 * Usage in integration tests:
 *
 *   import { request } from '../setup/httpClient';
 *
 *   it('GET /health returns 200', async () => {
 *     await request().get('/health').expect(200);
 *   });
 */
import supertest from "supertest";
import type { Application } from "express";

let _app: Application | null = null;

function loadApp(): Application {
  if (!_app) {
    // Ensure NODE_ENV=test so the app boots in test mode
    process.env.NODE_ENV = "test";
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _app = require("../../app").default as Application;
  }
  return _app;
}

/** Returns a supertest agent bound to the Express app. */
export function request(): supertest.SuperTest<supertest.Test> {
  return supertest(loadApp());
}

/** Exposes the raw app in case a test needs the Express instance directly. */
export function getApp(): Application {
  return loadApp();
}
