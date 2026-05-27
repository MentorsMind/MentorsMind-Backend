/**
 * Offline Support Routes
 *
 * All routes require authentication.
 * Rate-limited to prevent abuse of the sync/snapshot endpoints.
 *
 * Mounted at: /api/v1/offline
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { OfflineController } from '../controllers/offline.controller';

const router = Router();

// Stricter rate limit for sync endpoint (expensive DB operation)
const syncLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many sync requests. Please wait before retrying.',
  },
});

// Snapshot limiter (also expensive — fetches 5 domains in parallel)
const snapshotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many snapshot requests. Please wait before retrying.',
  },
});

// All offline routes require authentication
router.use(authenticate as any);

/**
 * @swagger
 * tags:
 *   name: Offline
 *   description: Offline support — snapshots, delta sync, and action queue
 */

/**
 * @swagger
 * /offline/snapshot:
 *   get:
 *     summary: Get full offline data snapshot
 *     description: |
 *       Returns a complete data bundle for offline use including profile,
 *       upcoming bookings, notifications, goals, and recent messages.
 *       Supports conditional requests via If-None-Match (ETag) — returns
 *       304 Not Modified if data hasn't changed.
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *         description: Force rebuild even if cached
 *     responses:
 *       200:
 *         description: Offline snapshot
 *       304:
 *         description: Not Modified (ETag matched)
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many requests
 */
router.get('/snapshot', snapshotLimiter, OfflineController.getSnapshot);

/**
 * @swagger
 * /offline/sync-state:
 *   get:
 *     summary: Get sync state per domain
 *     description: Returns the last sync timestamp and ETag for each data domain.
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sync state per domain
 */
router.get('/sync-state', OfflineController.getSyncState);

/**
 * @swagger
 * /offline/delta:
 *   get:
 *     summary: Get delta update for a domain
 *     description: Returns records changed in a domain since a given timestamp.
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bookings, notifications, profile, goals, messages]
 *       - in: query
 *         name: since
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO 8601 timestamp — return records updated after this time
 *     responses:
 *       200:
 *         description: Delta update
 *       400:
 *         description: Invalid parameters
 */
router.get('/delta', OfflineController.getDelta);

/**
 * @swagger
 * /offline/queue/status:
 *   get:
 *     summary: Get queue status summary
 *     description: Returns counts of actions per status (pending, completed, failed, conflict).
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Queue status counts
 */
// NOTE: /queue/status must be registered BEFORE /queue/:id to avoid route shadowing
router.get('/queue/status', OfflineController.getQueueStatus);

/**
 * @swagger
 * /offline/queue:
 *   get:
 *     summary: List queued offline actions
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, processing, completed, failed, conflict]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of queued actions
 */
router.get('/queue', OfflineController.getQueue);

/**
 * @swagger
 * /offline/queue:
 *   post:
 *     summary: Enqueue a single offline action
 *     description: |
 *       Persists an action captured while offline. Idempotent — re-submitting
 *       the same clientKey returns the existing record without re-processing.
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientKey, actionType, payload, clientTimestamp]
 *             properties:
 *               clientKey:
 *                 type: string
 *                 format: uuid
 *                 description: Client-generated UUID for idempotency
 *               actionType:
 *                 type: string
 *                 enum: [booking:create, booking:cancel, booking:reschedule,
 *                        review:create, note:create, note:update,
 *                        goal:update, profile:update, message:send]
 *               payload:
 *                 type: object
 *                 description: Action-specific data
 *               clientTimestamp:
 *                 type: string
 *                 format: date-time
 *                 description: When the action was captured on the client
 *     responses:
 *       201:
 *         description: Action enqueued
 *       400:
 *         description: Invalid request
 */
router.post('/queue', OfflineController.enqueueAction);

/**
 * @swagger
 * /offline/sync:
 *   post:
 *     summary: Full sync — enqueue actions and get delta updates
 *     description: |
 *       The primary sync endpoint for reconnecting mobile clients.
 *       Accepts queued offline actions and the client's current sync state,
 *       processes the actions, and returns delta updates for each domain.
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [syncState]
 *             properties:
 *               syncState:
 *                 type: object
 *                 required: [domains]
 *                 properties:
 *                   domains:
 *                     type: object
 *                     additionalProperties:
 *                       type: string
 *                       format: date-time
 *                     example:
 *                       bookings: "2026-05-01T00:00:00Z"
 *                       notifications: "2026-05-01T00:00:00Z"
 *                       profile: "2026-05-01T00:00:00Z"
 *               actions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [clientKey, actionType, payload, clientTimestamp]
 *                   properties:
 *                     clientKey:
 *                       type: string
 *                       format: uuid
 *                     actionType:
 *                       type: string
 *                     payload:
 *                       type: object
 *                     clientTimestamp:
 *                       type: string
 *                       format: date-time
 *     responses:
 *       200:
 *         description: Sync result with deltas and action results
 *       400:
 *         description: Invalid request
 *       429:
 *         description: Too many sync requests
 */
router.post('/sync', syncLimiter, OfflineController.sync);

/**
 * @swagger
 * /offline/conflicts/{id}/resolve:
 *   post:
 *     summary: Resolve a sync conflict
 *     description: |
 *       Resolve a conflict for a queued action using one of three strategies:
 *       - **client_wins**: Re-process the action, overwriting server state
 *       - **server_wins**: Discard the action, keep server state
 *       - **merge**: Apply a client-supplied merged payload
 *     tags: [Offline]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Action ID (from queue)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [strategy]
 *             properties:
 *               strategy:
 *                 type: string
 *                 enum: [client_wins, server_wins, merge]
 *               mergedPayload:
 *                 type: object
 *                 description: Required when strategy is "merge"
 *     responses:
 *       200:
 *         description: Conflict resolved
 *       400:
 *         description: Invalid strategy or action not in conflict state
 *       404:
 *         description: Action not found
 */
router.post('/conflicts/:id/resolve', OfflineController.resolveConflict);

export default router;
