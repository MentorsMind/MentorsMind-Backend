import { Response } from 'express';
import { AuthenticatedRequest } from '../types/api.types';
import { MessagingService } from '../services/messaging.service';
import { AttachmentService } from '../services/attachment.service';
import { ResponseUtil } from '../utils/response.utils';

export const ConversationsController = {
  /**
   * POST /api/v1/conversations
   * Create or retrieve an existing conversation between the authenticated user and another user.
   */
  async createOrGet(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { participantId } = req.body;

    if (!participantId) {
      ResponseUtil.error(res, 'participantId is required', 400);
      return;
    }

    if (participantId === userId) {
      ResponseUtil.error(res, 'Cannot start a conversation with yourself', 400);
      return;
    }

    const conversation = await MessagingService.getOrCreateConversation(userId, participantId);

    if (!conversation) {
      ResponseUtil.forbidden(
        res,
        'Messaging is only available between users who share at least one confirmed booking',
      );
      return;
    }

    ResponseUtil.success(res, conversation, 'Conversation retrieved');
  },

  /**
   * GET /api/v1/conversations
   * List all conversations for the authenticated user with last message preview and unread count.
   */
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const conversations = await MessagingService.listConversations(userId);
    ResponseUtil.success(res, { conversations }, 'Conversations retrieved');
  },

  /**
   * GET /api/v1/conversations/:id/messages
   * Cursor-based paginated message history.
   */
  async getMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { id } = req.params;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const cursor = req.query.cursor as string | undefined;

    const result = await MessagingService.getMessages(id, userId, limit, cursor);

    if (result.messages.length === 0) {
      const conv = await MessagingService.getConversation(id, userId);
      if (!conv) {
        ResponseUtil.notFound(res, 'Conversation not found');
        return;
      }
    }

    ResponseUtil.success(res, result, 'Messages retrieved');
  },

  /**
   * POST /api/v1/conversations/:id/messages
   * Send a message (REST fallback for Socket.IO).
   */
  async sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { id } = req.params;
    const { body } = req.body;

    if (!body || !String(body).trim()) {
      ResponseUtil.error(res, 'Message body is required', 400);
      return;
    }

    const message = await MessagingService.sendMessage(id, userId, String(body).trim());

    if (!message) {
      ResponseUtil.notFound(res, 'Conversation not found or access denied');
      return;
    }

    ResponseUtil.created(res, message, 'Message sent');
  },

  /**
   * DELETE /api/v1/conversations/:id/messages/:msgId
   * Soft-delete own message and remove any associated attachments from storage.
   */
  async deleteMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { id, msgId } = req.params;

    const deleted = await MessagingService.deleteMessage(id, msgId, userId);

    if (!deleted) {
      ResponseUtil.notFound(res, 'Message not found or you are not the sender');
      return;
    }

    await AttachmentService.deleteAttachmentsByMessage(msgId);

    ResponseUtil.success(res, null, 'Message deleted');
  },

  /**
   * POST /api/v1/conversations/:id/read
   * Mark all messages in a conversation as read for the authenticated user.
   */
  async markRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { id } = req.params;

    const conv = await MessagingService.getConversation(id, userId);
    if (!conv) {
      ResponseUtil.notFound(res, 'Conversation not found');
      return;
    }

    const count = await MessagingService.markAsRead(id, userId);
    ResponseUtil.success(res, { markedRead: count }, 'Messages marked as read');
  },

  /**
   * POST /api/v1/conversations/:id/attachments
   * Upload and attach a file (image or PDF) to a conversation.
   */
  async uploadAttachment(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.id;
    const { id } = req.params;

    const file = (req as any).file;
    if (!file) {
      ResponseUtil.error(res, 'No file uploaded', 400);
      return;
    }

    const result = await AttachmentService.uploadAttachment(
      id,
      userId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    if (!result) {
      ResponseUtil.notFound(res, 'Conversation not found or access denied');
      return;
    }

    ResponseUtil.created(res, result, 'Attachment uploaded');
  },
};
