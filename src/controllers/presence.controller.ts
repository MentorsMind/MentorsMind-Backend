// @ts-nocheck
import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { PresenceService } from "../services/presence.service";
import { redis } from "../config/redis"; // your existing ioredis instance

const presenceService = new PresenceService(redis);

// ─── Validation schemas ───────────────────────────────────────────────────────

const batchStatusSchema = z.object({
  userIds: z
    .array(z.string().uuid())
    .min(1, "At least one userId required")
    .max(100, "Maximum 100 userIds per request"),
});

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/users/:id/online
 *
 * Returns the online status of a single user.
 * Privacy check: requester must share a confirmed/in-progress session
 * with the target, or be the target themselves.
 *
 * Response 200:
 *   { online: boolean, last_seen: string | null }
 *
 * Response 403:
 *   { message: "Not authorised to view this user's online status" }
 */
export async function getUserOnlineStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const requesterId = req.user!.userId; // set by JWT auth middleware
    const targetId = req.params.id;

    const allowed = await presenceService.canViewStatus(requesterId, targetId);
    if (!allowed) {
      res.status(403).json({
        message: "Not authorised to view this user's online status",
      });
      return;
    }

    const status = await presenceService.getStatus(targetId);

    res.status(200).json({
      online: status.online,
      last_seen: status.last_seen,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/users/online-status
 *
 * Batch query: returns online status for an array of user IDs.
 * User IDs that the requester is not authorised to see are silently omitted
 * from the response rather than returning a 403 for the whole request.
 *
 * Request body:
 *   { userIds: string[] }   (UUIDs, max 100)
 *
 * Response 200:
 *   { statuses: Array<{ userId, online, last_seen }> }
 */
export async function getBatchOnlineStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = batchStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const requesterId = req.user!.userId;
    const { userIds } = parsed.data;

    // Privacy: silently filter to only authorised targets
    const authorised = await presenceService.filterAuthorised(
      requesterId,
      userIds
    );

    const statuses = await presenceService.getBatchStatus(authorised);

    res.status(200).json({ statuses });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/presence/heartbeat
 *
 * Called by the client every 20 seconds to keep the presence key alive.
 * Also accepts a WebSocket ping (handled in socket.ts), but this REST
 * fallback supports clients that cannot maintain a WebSocket connection.
 *
 * Response 204: No Content
 */
export async function heartbeat(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    await presenceService.markOnline(userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}