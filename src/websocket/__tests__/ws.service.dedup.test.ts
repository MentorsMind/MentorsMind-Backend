/**
 * #394 — WsService.subscribeToRedis dedup guard
 * Verifies the callback is invoked only once per message even when
 * subscribeToRedis is called multiple times.
 *
 * Note: jest.ws.config.ts sets resetModules:true, so each test file gets
 * a fresh module registry. We use jest.isolateModules to control imports
 * within individual tests.
 */

jest.mock("../../config/index", () => ({
  default: {
    redis: { url: "redis://localhost:6379" },
    isDevelopment: false,
    server: {},
  },
}));
jest.mock("../../utils/logger.utils", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  },
}));

import EventEmitter from "events";

/** Wait for all pending microtasks + one macrotask tick */
const flush = () => new Promise<void>((r) => setTimeout(r, 10));

describe("WsService.subscribeToRedis dedup guard", () => {
  it("invokes callback only once per message even when called twice", async () => {
    const sub = new EventEmitter() as any;
    sub.subscribe = jest.fn().mockResolvedValue(undefined);
    sub.removeAllListeners = jest.fn((event?: string) => {
      EventEmitter.prototype.removeAllListeners.call(sub, event);
    });

    jest.doMock("../../config/redis.pubsub", () => ({
      getRedisClients: jest
        .fn()
        .mockResolvedValue({ sub, CHANNEL: "ws:events" }),
    }));

    const { WsService } = await import("../../services/ws.service");
    const callback = jest.fn();

    WsService.subscribeToRedis(callback);
    WsService.subscribeToRedis(callback); // second call — should be a no-op

    await flush();

    sub.emit(
      "message",
      "ws:events",
      JSON.stringify({ userId: "u1", payload: { event: "test" } }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("u1", { event: "test" });
  });

  it("getRedisClients is called only once for multiple subscribeToRedis calls", async () => {
    const sub = new EventEmitter() as any;
    sub.subscribe = jest.fn().mockResolvedValue(undefined);
    sub.removeAllListeners = jest.fn((event?: string) => {
      EventEmitter.prototype.removeAllListeners.call(sub, event);
    });

    const getRedisClients = jest
      .fn()
      .mockResolvedValue({ sub, CHANNEL: "ws:events" });
    jest.doMock("../../config/redis.pubsub", () => ({ getRedisClients }));

    const { WsService } = await import("../../services/ws.service");

    WsService.subscribeToRedis(jest.fn());
    WsService.subscribeToRedis(jest.fn());

    await flush();

    expect(getRedisClients).toHaveBeenCalledTimes(1);
  });
});
