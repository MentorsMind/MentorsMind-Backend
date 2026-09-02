/**
 * Shard routing for inbound requests (issue #865).
 *
 * Resolves the shard once per request from the authenticated principal, so
 * downstream handlers read `req.shard` rather than each deriving the key and
 * risking two handlers disagreeing about where a row lives.
 */

import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";
import shardingConfig from "../config/sharding.config";
import ShardManagerService from "../services/shard-manager.service";

export interface ShardContext {
  key: string;
  shardId: string;
}

declare module "express-serve-static-core" {
  interface Request {
    shard?: ShardContext;
  }
}

/**
 * Extract the shard key from a request.
 *
 * Order matters: the authenticated user wins over anything client-supplied, so
 * a caller cannot address another tenant's shard by setting a header or query
 * parameter.
 */
export function resolveShardKey(req: Request): string | null {
  const user = (req as { user?: { id?: string | number } }).user;
  if (user?.id !== undefined && user.id !== null) return String(user.id);

  const header = req.headers["x-shard-key"];
  if (typeof header === "string" && header.trim()) return header.trim();

  const param = (req.params as Record<string, string> | undefined)?.userId;
  if (param) return param;

  return null;
}

export function shardRoutingMiddleware() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!shardingConfig.enabled || !ShardManagerService.enabled) {
      next();
      return;
    }

    const key = resolveShardKey(req);
    if (!key) {
      // No key is normal for unauthenticated and global endpoints; those run
      // against the primary rather than being rejected.
      next();
      return;
    }

    const shardId = ShardManagerService.locate(key);
    if (!shardId) {
      logger.warn({ key }, "No shard resolved for request key");
      next();
      return;
    }

    req.shard = { key, shardId };
    next();
  };
}

export default shardRoutingMiddleware;
