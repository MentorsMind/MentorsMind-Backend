import Redis from "ioredis";
import { redisConfig } from "./redis.config";

export const CHANNEL = "ws:events";

let sub: Redis | null = null;
let pub: Redis | null = null;

export async function getRedisClients(): Promise<{
  sub: Redis;
  pub: Redis;
  CHANNEL: string;
}> {
  if (!sub) {
    sub = new Redis(redisConfig.url!, { lazyConnect: true });
    await sub.connect();
  }
  if (!pub) {
    pub = new Redis(redisConfig.url!, { lazyConnect: true });
    await pub.connect();
  }
  return { sub, pub, CHANNEL };
}
