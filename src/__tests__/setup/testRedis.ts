/**
 * Integration test Redis helper.
 *
 * The Redis client is created lazily on first access so that REDIS_URL / the
 * TEST_REDIS_* env vars set by globalSetup are resolved before connecting.
 */
import Redis from "ioredis";

let _redis: Redis | null = null;

function buildRedis(): Redis {
  // Prefer REDIS_URL (overwritten by globalSetup to point at the container)
  const url = process.env.REDIS_URL;

  if (url) {
    return new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  return new Redis({
    host: process.env.TEST_REDIS_HOST || "localhost",
    port: parseInt(process.env.TEST_REDIS_PORT || "6379", 10),
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

export function getTestRedis(): Redis {
  if (!_redis) {
    _redis = buildRedis();
  }
  return _redis;
}

/** Flush all keys in the test Redis instance. */
export async function flushRedis(): Promise<void> {
  await getTestRedis().flushall();
}

/** Call in globalTeardown (or afterAll) to close the connection. */
export async function closeTestRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
