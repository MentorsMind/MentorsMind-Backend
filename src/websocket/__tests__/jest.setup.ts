// Minimal setup for WebSocket tests — no DB connection needed
// All external dependencies are mocked in each test file
process.env.NODE_ENV = "test";

// uuid v13 is pure ESM; provide a minimal CJS-compatible stub so Jest can
// load modules that transitively import uuid (e.g. tracing.middleware).
jest.mock("uuid", () => ({
  v4: () => "test-uuid-v4",
  v1: () => "test-uuid-v1",
}));
