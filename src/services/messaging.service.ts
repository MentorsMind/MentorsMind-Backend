import pool from '../config/database';
import { SocketService } from './socket.service';
import { logger } from '../utils/logger.utils';

export interface ConversationRecord {
  id: string;
  participant_one_id: string;
  participant_two_id: string;
  last_message_id: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // Joined
  other_user_id?: string;
  other_user_name?: string;
  other_user_avatar?: string | null;
  last_message_body?: string | null;
  unread_count?: number;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  is_deleted: boolean;
  deleted_at: Date | null;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // Joined
  sender_name?: string;
  sender_avatar?: string | null;
}

export const MessagingService = {
  /**
   * Get or create a conversation between two users.
   * Returns null when they share no valid booking.
   * Valid bookings are those that are confirmed, in_progress, or completed.
   */
  async getOrCreateConversation(
    userAId: string,
    userBId: string,
  ): Promise<ConversationRecord | null> {
    const { rows: bookingRows } = await pool.query(
      `SELECT id FROM bookings
       WHERE (mentor_id = $1 AND mentee_id = $2)
          OR (mentor_id = $2 AND mentee_id = $1)
       AND status IN ('confirmed', 'in_progress', 'completed')
       LIMIT 1`,
      [userAId, userBId],
    );

    if (bookingRows.length === 0) return null;

    // Canonical ordering: smaller UUID is always participant_one
    const { rows } = await pool.query<ConversationRecord>(
      `INSERT INTO conversations (participant_one_id, participant_two_id)
       VALUES (
         LEAST($1::text, $2::text)::uuid,
         GREATEST($1::text, $2::text)::uuid
       )
       ON CONFLICT ON CONSTRAINT unique_conversation DO UPDATE
         SET updated_at = conversations.updated_at
       RETURNING *`,
      [userAId, userBId],
    );

    return rows[0] || null;
  },

  /**
   * List all conversations for a user with last message preview and unread count.
   */
  async listConversations(userId: string): Promise<ConversationRecord[]> {
    const { rows } = await pool.query<ConversationRecord>(
      `SELECT
         c.id,
         c.participant_one_id,
         c.participant_two_id,
         c.last_message_id,
         c.last_message_at,
         c.created_at,
         c.updated_at,
         CASE
           WHEN c.participant_one_id = $1 THEN c.participant_two_id
           ELSE c.participant_one_id
         END AS other_user_id,
         CONCAT(u.first_name, ' ', u.last_name) AS other_user_name,
         u.avatar_url AS other_user_avatar,
         m.body AS last_message_body,
         (
           SELECT COUNT(*)::int
           FROM messages um
           WHERE um.conversation_id = c.id
             AND um.sender_id != $1
             AND um.read_at IS NULL
             AND um.is_deleted = FALSE
         ) AS unread_count
       FROM conversations c
       JOIN users u ON u.id = CASE
         WHEN c.participant_one_id = $1 THEN c.participant_two_id
         ELSE c.participant_one_id
       END
       LEFT JOIN messages m ON m.id = c.last_message_id AND m.is_deleted = FALSE
       WHERE c.participant_one_id = $1 OR c.participant_two_id = $1
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
      [userId],
    );

    return rows;
  },

  /**
   * Get a single conversation, verifying the user is a participant.
   */
  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<ConversationRecord | null> {
    const { rows } = await pool.query<ConversationRecord>(
      `SELECT * FROM conversations
       WHERE id = $1
         AND (participant_one_id = $2 OR participant_two_id = $2)`,
      [conversationId, userId],
    );

    return rows[0] || null;
  },

  /**
   * Cursor-based paginated message history (newest first).
   * cursor = message ID to paginate from.
   */
  async getMessages(
    conversationId: string,
    userId: string,
    limit: number = 50,
    cursor?: string,
  ): Promise<{ messages: MessageRecord[]; nextCursor: string | null }> {
    const conv = await this.getConversation(conversationId, userId);
    if (!conv) return { messages: [], nextCursor: null };

    const params: unknown[] = [conversationId, limit + 1];
    let cursorClause = '';

    if (cursor) {
      const { rows: cursorRows } = await pool.query<{ created_at: Date }>(
        `SELECT created_at FROM messages WHERE id = $1`,
        [cursor],
      );
      if (cursorRows[0]) {
        cursorClause = `AND m.created_at < $3`;
        params.push(cursorRows[0].created_at);
      }
    }

    const { rows } = await pool.query<MessageRecord>(
      `SELECT
         m.id, m.conversation_id, m.sender_id, m.body,
         m.is_deleted, m.deleted_at, m.read_at,
         m.created_at, m.updated_at,
         CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
         u.avatar_url AS sender_avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1
         ${cursorClause}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      params,
    );

    const hasMore = rows.length > limit;
    const messages = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? messages[messages.length - 1].id : null;

    return {
      messages: messages.map((m) =>
        m.is_deleted ? { ...m, body: '[Message deleted]' } : m,
      ),
      nextCursor,
    };
  },

  /**
   * Send a message and emit via Socket.IO to the recipient.
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    body: string,
  ): Promise<MessageRecord | null> {
    const conv = await this.getConversation(conversationId, senderId);
    if (!conv) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<MessageRecord>(
        `INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [conversationId, senderId, body],
      );

      const message = rows[0];

      await client.query(
        `UPDATE conversations
         SET last_message_id = $1, last_message_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [message.id, message.created_at, conversationId],
      );

      await client.query('COMMIT');

      const recipientId =
        conv.participant_one_id === senderId
          ? conv.participant_two_id
          : conv.participant_one_id;

      SocketService.emitToUser(recipientId, 'message:new', {
        conversationId,
        message,
      });

      logger.debug('MessagingService: message sent', {
        messageId: message.id,
        conversationId,
        senderId,
      });

      return message;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('MessagingService: sendMessage failed', { err });
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Soft-delete a message. Only the sender can delete.
   */
  async deleteMessage(
    conversationId: string,
    messageId: string,
    userId: string,
  ): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE messages
       SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND conversation_id = $2
         AND sender_id = $3
         AND is_deleted = FALSE`,
      [messageId, conversationId, userId],
    );

    return (rowCount ?? 0) > 0;
  },

  /**
   * Mark all unread messages in a conversation as read for a user.
   * Only marks messages sent by the other participant.
   */
  async markAsRead(conversationId: string, userId: string): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE messages
       SET read_at = NOW(), updated_at = NOW()
       WHERE conversation_id = $1
         AND sender_id != $2
         AND read_at IS NULL
         AND is_deleted = FALSE`,
      [conversationId, userId],
    );

    return rowCount ?? 0;
  },

  /**
   * Full-text search across all conversations the user participates in.
   */
  async searchMessages(
    userId: string,
    query: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    results: Array<MessageRecord & { headline: string }>;
    total: number;
    page: number;
    totalPages: number;
  }> {
    // Input validation - limit query length to prevent abuse
    if (!query || query.length > 200) {
      return { results: [], total: 0, page, totalPages: 0 };
    }

    const offset = (page - 1) * limit;
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return { results: [], total: 0, page, totalPages: 0 };
    }

    const { rows } = await pool.query(
      `SELECT
         m.id, m.conversation_id, m.sender_id, m.body,
         m.is_deleted, m.deleted_at, m.read_at,
         m.created_at, m.updated_at,
         ts_headline(
           'english', m.body,
           plainto_tsquery('english', $2),
           'StartSel=<mark>,StopSel=</mark>,MaxWords=20,MinWords=5'
         ) AS headline,
         CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
         u.avatar_url AS sender_avatar,
         COUNT(*) OVER() AS total_count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = m.sender_id
       WHERE (c.participant_one_id = $1 OR c.participant_two_id = $1)
         AND m.is_deleted = FALSE
         AND to_tsvector('english', m.body) @@ plainto_tsquery('english', $2)
       ORDER BY
         ts_rank(to_tsvector('english', m.body), plainto_tsquery('english', $2)) DESC,
         m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, trimmedQuery, limit, offset],
    );

    const total = rows.length > 0 ? parseInt((rows[0] as any).total_count, 10) : 0;

    return {
      results: rows as any,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  },
};
