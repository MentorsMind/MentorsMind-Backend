import Redis from "ioredis";
import { env } from "./env";
import { redisConfig } from "./redis.config";

const redisUrl = env.REDIS_URL ?? redisConfig.url ?? "redis://localhost:6379";
export const redis = new Redis(redisUrl, redisConfig.options);
import Redis from "ioredis";
import { env } from "./env";
import { redisConfig } from "./redis.config";

const redisUrl = env.REDIS_URL ?? redisConfig.url ?? "redis://localhost:6379";
export const redis = new Redis(redisUrl, redisConfig.options);
