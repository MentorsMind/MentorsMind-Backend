import { redis } from "../config/redis";

export const STELLAR_STREAM_CURSOR_KEY_PREFIX = "stellar:stream:cursor";
export const STELLAR_STREAM_CURSOR_TTL_SECONDS = 7 * 24 * 60 * 60;

export function getStellarStreamCursorKey(account: string): string {
  return `${STELLAR_STREAM_CURSOR_KEY_PREFIX}:${account}`;
}

export async function loadStellarStreamCursor(account: string): Promise<string> {
  try {
    const value = await redis.get(getStellarStreamCursorKey(account));
    return value && value.trim().length > 0 ? value : "now";
  } catch (error) {
    return "now";
  }
}

export async function saveStellarStreamCursor(
  account: string,
  cursor: string,
): Promise<void> {
  if (!cursor || cursor.trim().length === 0) {
    return;
  }

  try {
    await redis.set(
      getStellarStreamCursorKey(account),
      cursor,
      "EX",
      STELLAR_STREAM_CURSOR_TTL_SECONDS,
    );
  } catch (error) {
    // Best effort persistence; stream processing should continue if Redis is unavailable.
  }
}

export async function clearStellarStreamCursor(account: string): Promise<void> {
  try {
    await redis.del(getStellarStreamCursorKey(account));
  } catch {
    // Best effort cleanup.
  }
}
