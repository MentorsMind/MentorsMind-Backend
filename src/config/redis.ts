import Redis from 'ioredis';
import { redisConfig } from './redis.config';

const url = redisConfig.url ?? 'redis://127.0.0.1:6379';

export const redis = new Redis(url, redisConfig.options);
