/**
 * Idempotency Middleware
 *
 * Prevents duplicate mutations on payment/booking/escrow endpoints.
 * Clients send `Idempotency-Key: <uuid>` on POST requests.
 *
 * Behaviour:
 *  - First request  → process normally, persist response in DB
 *  - Duplicate key  → return stored response immediately (X-Idempotency-Replayed: true)
 *  - Same key, different endpoint → 409 Conflict
 *  - Keys expire after 24 hours (re-processed as fresh)
 */

import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { logger } from "../utils/logger.utils";

const TTL_HOURS = 24;

export const idempotency = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

  if (!idempotencyKey) {
    res
      .status(400)
      .json({ success: false, error: "Idempotency-Key header is required" });
    return;
  }

  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    res
      .status(400)
      .json({ success: false, error: "Idempotency-Key must be a valid UUID" });
    return;
  }

  const userId = (req as any).user?.userId;
  if (!userId) {
    // Auth middleware should have already rejected unauthenticated requests
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const endpoint = `${req.method} ${req.route?.path ?? req.path}`;

  try {
    const { rows } = await pool.query<{
      endpoint: string;
      response_body: unknown;
      created_at: Date;
    }>(
      `SELECT endpoint, response_body, created_at
         FROM idempotency_keys
        WHERE key = $1 AND user_id = $2`,
      [idempotencyKey, userId],
    );

    if (rows.length > 0) {
      const record = rows[0];
      const ageMs = Date.now() - new Date(record.created_at).getTime();

      // Expired — delete and fall through to process fresh
      if (ageMs > TTL_HOURS * 3_600_000) {
        await pool.query(
          `DELETE FROM idempotency_keys WHERE key = $1 AND user_id = $2`,
          [idempotencyKey, userId],
        );
      } else if (record.endpoint !== endpoint) {
        // Same key, different endpoint → conflict
        res.status(409).json({
          success: false,
          error: `Idempotency-Key already used for ${record.endpoint}`,
        });
        return;
      } else {
        // Valid cache hit — replay stored response
        logger.info("Idempotency cache hit", { idempotencyKey, endpoint });
        res.setHeader("X-Idempotency-Replayed", "true");
        res
          .status((record.response_body as any).__status ?? 200)
          .json((record.response_body as any).__body);
        return;
      }
    }

    // Intercept res.json to persist the response after it is sent
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        pool
          .query(
            `INSERT INTO idempotency_keys (key, user_id, endpoint, response_body)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (key, user_id) DO NOTHING`,
            [
              idempotencyKey,
              userId,
              endpoint,
              JSON.stringify({ __status: status, __body: body }),
            ],
          )
          .catch((err) => {
            logger.warn("Failed to persist idempotency key", {
              err,
              idempotencyKey,
            });
          });
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    logger.warn("Idempotency middleware error — failing open", { err });
    next();
  }
};
