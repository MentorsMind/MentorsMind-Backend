import { CircuitBreaker } from "../circuit-breaker";

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and rejects requests", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(cb.canRequest()).toBe(true);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();

    expect(cb.getState()).toBe("open");
    expect(cb.canRequest()).toBe(false);
    expect(cb.getTripCount()).toBe(1);
  });

  it("moves to half-open after the reset timeout and closes on success", () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 500 });
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);

    jest.setSystemTime(now + 600);
    expect(cb.canRequest()).toBe(true); // half-open trial
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");

    jest.useRealTimers();
  });

  it("re-opens if the half-open trial fails", () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 500 });
    cb.recordFailure();
    jest.setSystemTime(now + 600);
    cb.canRequest();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.getTripCount()).toBe(2);

    jest.useRealTimers();
  });

  it("reset returns to closed", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    cb.recordFailure();
    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.canRequest()).toBe(true);
  });
});
