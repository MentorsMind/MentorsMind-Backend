import Redis, { Cluster } from "ioredis";
import { env } from "./env";
import { redisConfig } from "./redis.config";
import { logger } from "../utils/logger";

let redisClient: Redis | Cluster;

if (redisConfig.clusterEnabled && redisConfig.clusterNodes) {
  logger.info('Initializing Redis Cluster with nodes:', { nodes: redisConfig.clusterNodes });
  redisClient = new Cluster(
    redisConfig.clusterNodes.map(node => {
      const [host, port] = node.split(':');
      return { host, port: parseInt(port, 10) };
    }),
    {
      ...redisConfig.options,
      clusterRetryStrategy: (times) => Math.min(times * 100, 3000),
    }
  );
} else {
  const redisUrl = env.REDIS_URL ?? redisConfig.url ?? "redis://localhost:6379";
  logger.info('Initializing single Redis instance:', { url: redisUrl });
  redisClient = new Redis(redisUrl, redisConfig.options);
}

export const redis = redisClient;
