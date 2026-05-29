/**
 * Jest setupFilesAfterEnv for integration tests.
 *
 * Loaded once per test *file* (not per test), in the worker process that
 * already has the testcontainer env vars inherited from the main process.
 *
 * - Resets the database to a blank slate before each test.
 * - Flushes Redis before each test.
 * - Closes connections after all tests in the file finish.
 */
import { truncateAllTables, closeTestDb } from "./testDb";
import { flushRedis, closeTestRedis } from "./testRedis";

// Extend timeout for integration tests that hit real infrastructure
jest.setTimeout(30_000);

beforeEach(async () => {
  await Promise.all([truncateAllTables(), flushRedis()]);
});

afterAll(async () => {
  await Promise.all([closeTestDb(), closeTestRedis()]);
});
