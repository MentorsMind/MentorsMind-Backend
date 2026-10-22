jest.mock("../../utils/logger.utils", () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));
jest.mock("../errorHandler", () => ({
  createError: jest.fn(),
}));

describe("auth last-active debounce cleanup", () => {
  let lastActiveDebounce: typeof import("../auth.middleware").lastActiveDebounce;
  let stopAuthDebounceCleanup = () => {};

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    jest.resetModules();
    ({ lastActiveDebounce, stopAuthDebounceCleanup } =
      require("../auth.middleware") as typeof import("../auth.middleware"));
  });

  afterEach(() => {
    stopAuthDebounceCleanup();
    jest.useRealTimers();
    jest.resetModules();
  });

  it("evicts entries after the five-minute cleanup interval when their TTL has expired", () => {
    const now = Date.now();
    lastActiveDebounce.set("expired-user", {
      timestamp: now,
      expiresAt: now + 2 * 60 * 1000,
    });
    lastActiveDebounce.set("active-user", {
      timestamp: now,
      expiresAt: now + 10 * 60 * 1000,
    });

    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(lastActiveDebounce.has("expired-user")).toBe(false);
    expect(lastActiveDebounce.has("active-user")).toBe(true);
  });

  it("keeps the map bounded as expired users accumulate", () => {
    const ttl = 2 * 60 * 1000;

    for (let batch = 0; batch < 3; batch += 1) {
      const now = Date.now();
      for (let user = 0; user < 100; user += 1) {
        const userId = `user-${batch}-${user}`;
        lastActiveDebounce.set(userId, {
          timestamp: now,
          expiresAt: now + ttl,
        });
      }

      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(lastActiveDebounce.size).toBe(0);
    }
  });
});
