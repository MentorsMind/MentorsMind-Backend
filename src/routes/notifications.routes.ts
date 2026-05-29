import { Router } from "express";
import { NotificationsController } from "../controllers/notifications.controller";
import { NotificationPreferencesController } from "../controllers/notificationPreferences.controller";
import { PushController } from "../controllers/push.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: In-app notification management endpoints
 */

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get paginated list of notifications (unread first)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of notifications per page
 *     responses:
 *       200:
 *         description: List of notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Notification'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         hasMore:
 *                           type: boolean
 */
router.get("/", authenticate, NotificationsController.getNotifications);

/**
 * @swagger
 * /api/v1/notifications/unread-count:
 *   get:
 *     summary: Get count of unread notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread notification count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: integer
 *                       example: 5
 */
router.get(
  "/unread-count",
  authenticate,
  NotificationsController.getUnreadCount,
);

/**
 * @swagger
 * /api/v1/notifications/read-all:
 *   put:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: 5 notifications marked as read
 *                     count:
 *                       type: integer
 *                       example: 5
 */
router.put("/read-all", authenticate, NotificationsController.markAllAsRead);

/**
 * @swagger
 * /api/v1/notifications/{id}/read:
 *   put:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       404:
 *         description: Notification not found
 */
router.put("/:id/read", authenticate, NotificationsController.markAsRead);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   delete:
 *     summary: Delete a notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification ID
 *     responses:
 *       200:
 *         description: Notification deleted successfully
 *       404:
 *         description: Notification not found
 */
router.delete("/:id", authenticate, NotificationsController.deleteNotification);

/**
 * @swagger
 * /api/v1/notifications/preferences:
 *   get:
 *     summary: Get user's current notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification preferences
 *   put:
 *     summary: Update notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               preferences:
 *                 type: object
 *                 description: Preference matrix (type x channel)
 *     responses:
 *       200:
 *         description: Preferences updated successfully
 */
router.get(
  "/preferences",
  authenticate,
  NotificationPreferencesController.getPreferences,
);
router.put(
  "/preferences",
  authenticate,
  NotificationPreferencesController.updatePreferences,
);

/**
 * @swagger
 * /api/v1/notifications/preferences/reset:
 *   post:
 *     summary: Reset notification preferences to defaults
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Preferences reset successfully
 */
router.post(
  "/preferences/reset",
  authenticate,
  NotificationPreferencesController.resetPreferences,
);

/**
 * @swagger
 * /api/v1/notifications/push/subscribe:
 *   post:
 *     summary: Subscribe to push notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: FCM device token
 *               deviceType:
 *                 type: string
 *                 enum: [web, android, ios]
 *               deviceId:
 *                 type: string
 *                 description: Unique device identifier
 *     responses:
 *       200:
 *         description: Successfully subscribed
 *       400:
 *         description: Invalid request
 */
router.post("/push/subscribe", authenticate, PushController.subscribe);

/**
 * @swagger
 * /api/v1/notifications/push/unsubscribe:
 *   delete:
 *     summary: Unsubscribe from push notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: FCM device token to remove
 *     responses:
 *       200:
 *         description: Successfully unsubscribed
 *       404:
 *         description: Token not found
 */
router.delete("/push/unsubscribe", authenticate, PushController.unsubscribe);

/**
 * @swagger
 * /api/v1/notifications/push/tokens:
 *   get:
 *     summary: Get all active push tokens for the authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active push tokens
 */
router.get("/push/tokens", authenticate, PushController.getTokens);

/**
 * @swagger
 * /api/v1/notifications/push/test:
 *   post:
 *     summary: Send test push notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test notification sent
 */
router.post("/push/test", authenticate, PushController.sendTest);

/**
 * @swagger
 * /api/v1/notifications/push/send:
 *   post:
 *     summary: Send rich push notification with actions and deep link
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title:
 *                 type: string
 *               body:
 *                 type: string
 *               deepLink:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [high, normal]
 *               actions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *     responses:
 *       200:
 *         description: Notification sent
 */
router.post("/push/send", authenticate, PushController.sendRich);

/**
 * @swagger
 * components:
 *   schemas:
 *     Notification:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         user_id:
 *           type: string
 *           format: uuid
 *         type:
 *           type: string
 *           enum: [session_booked, session_confirmed, session_cancelled, session_reminder, payment_received, payment_failed, review_received, escrow_released, dispute_opened]
 *         title:
 *           type: string
 *         message:
 *           type: string
 *         data:
 *           type: object
 *         is_read:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

export default router;
