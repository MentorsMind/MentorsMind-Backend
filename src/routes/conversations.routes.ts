import { Router } from 'express';
import { ConversationsController } from '../controllers/conversations.controller';
import { authenticate } from '../middleware/auth.middleware';
import { screenMessage } from '../middleware/content-moderation.middleware';
import { asyncHandler } from '../utils/asyncHandler.utils';
import { validate } from '../middleware/validation.middleware';
import {
  createOrGetConversationSchema,
  getMessagesSchema,
  sendMessageSchema,
  deleteMessageSchema,
  markReadSchema,
  batchMarkReadSchema,
  uploadAttachmentSchema,
} from '../validators/schemas/conversations.schemas';
import {
  cleanupUploadedFile,
  createFileUpload,
} from '../middleware/file-upload.middleware';

const router = Router();

const upload = createFileUpload({
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB hard cap
});

/**
 * @swagger
 * tags:
 *   name: Conversations
 *   description: Direct messaging between mentors and learners
 */

/**
 * @swagger
 * /api/v1/conversations:
 *   post:
 *     summary: Create or retrieve a conversation
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [participantId]
 *             properties:
 *               participantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Conversation retrieved or created
 *       403:
 *         description: No shared booking between users
 */
router.post(
  '/',
  authenticate,
  validate(createOrGetConversationSchema),
  asyncHandler(ConversationsController.createOrGet),
);

/**
 * @swagger
 * /api/v1/conversations:
 *   get:
 *     summary: List all conversations for the authenticated user
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Conversation list with last message preview and unread count
 */
router.get('/', authenticate, asyncHandler(ConversationsController.list));

/**
 * @swagger
 * /api/v1/conversations/{id}/messages:
 *   get:
 *     summary: Get paginated message history (cursor-based)
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Message ID to paginate from
 *     responses:
 *       200:
 *         description: Paginated messages with nextCursor
 */
router.get(
  '/:id/messages',
  authenticate,
  validate(getMessagesSchema),
  asyncHandler(ConversationsController.getMessages),
);

/**
 * @swagger
 * /api/v1/conversations/{id}/messages:
 *   post:
 *     summary: Send a message (REST fallback)
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body:
 *                 type: string
 *     responses:
 *       201:
 *         description: Message sent
 */
router.post('/:id/messages', authenticate, screenMessage, asyncHandler(ConversationsController.sendMessage));

/**
 * @swagger
 * /api/v1/conversations/{id}/messages/{msgId}:
 *   delete:
 *     summary: Soft-delete own message
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: msgId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Message deleted
 *       404:
 *         description: Message not found or not sender
 */
router.delete(
  '/:id/messages/:msgId',
  authenticate,
  validate(deleteMessageSchema),
  asyncHandler(ConversationsController.deleteMessage),
);

/**
 * @swagger
 * /api/v1/conversations/{id}/read:
 *   post:
 *     summary: Mark all messages in a conversation as read
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Messages marked as read
 */
router.post(
  '/:id/read',
  authenticate,
  validate(markReadSchema),
  asyncHandler(ConversationsController.markRead),
);

/**
 * @swagger
 * /api/v1/conversations/{id}/messages/read:
 *   post:
 *     summary: Batch mark specific messages as read
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messageIds]
 *             properties:
 *               messageIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Messages marked as read
 *       400:
 *         description: Invalid input
 */
router.post(
  '/:id/messages/read',
  authenticate,
  validate(batchMarkReadSchema),
  asyncHandler(ConversationsController.batchMarkAsRead),
);

/**
 * @swagger
 * /api/v1/conversations/{id}/attachments:
 *   post:
 *     summary: Upload a file attachment (JPEG/PNG/WebP max 10MB, PDF max 20MB)
 *     tags: [Conversations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Attachment uploaded with signed URL
 *       400:
 *         description: Invalid file type/size or quota exceeded
 */
router.post(
  '/:id/attachments',
  authenticate,
  validate(uploadAttachmentSchema),
  upload.single('file'),
  cleanupUploadedFile,
  asyncHandler(ConversationsController.uploadAttachment),
);

export default router;
