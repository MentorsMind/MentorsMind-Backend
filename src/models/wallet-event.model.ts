import { db } from "../config/database";
import { Logger } from "../utils/logger.utils";

export interface WalletEvent {
  id: string;
  user_id: string;
  event_type:
    | "balance_check"
    | "payout_request"
    | "trustline_add"
    | "transaction_view"
    | "wallet_created"
    | "earnings_view"
    | "wallet_status_changed";
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export const WalletEventModel = {
  async create(eventData: {
    userId: string;
    eventType: WalletEvent["event_type"];
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<WalletEvent | null> {
    const query = `
      INSERT INTO wallet_events (user_id, event_type, metadata, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const metadataJson = JSON.stringify(eventData.metadata || {});
    const values = [
      eventData.userId,
      eventData.eventType,
      metadataJson,
      eventData.ipAddress || null,
      eventData.userAgent || null,
    ];

    try {
      const { rows } = await db.query(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error({ err: error }, "Failed to create wallet event");
      return null;
    }
  },

  async findByUserId(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<WalletEvent[]> {
    const query = `
      SELECT * FROM wallet_events 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3;
    `;
    const { rows } = await db.query(query, [userId, limit, offset]);
    return rows;
  },

  async findByEventType(
    eventType: WalletEvent["event_type"],
    limit = 50,
    offset = 0,
  ): Promise<WalletEvent[]> {
    const query = `
      SELECT * FROM wallet_events 
      WHERE event_type = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3;
    `;
    const { rows } = await db.query(query, [eventType, limit, offset]);
    return rows;
  },

  async findByUserAndType(
    userId: string,
    eventType: WalletEvent["event_type"],
    limit = 50,
    offset = 0,
  ): Promise<WalletEvent[]> {
    const query = `
      SELECT * FROM wallet_events
      WHERE user_id = $1 AND event_type = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4;
    `;
    const { rows } = await db.query(query, [userId, eventType, limit, offset]);
    return rows;
  },

  async getEventStats(userId?: string): Promise<{
    totalEvents: number;
    byType: any[];
    recentEvents: WalletEvent[];
  }> {
    let totalQuery = "SELECT COUNT(*) FROM wallet_events";
    let typeQuery = "SELECT event_type, COUNT(*) as count FROM wallet_events";
    let recentQuery = "SELECT * FROM wallet_events";
    const params: any[] = [];

    if (userId) {
      totalQuery += " WHERE user_id = $1";
      typeQuery += " WHERE user_id = $1";
      recentQuery += " WHERE user_id = $1";
      params.push(userId);
    }

    typeQuery += " GROUP BY event_type";
    recentQuery += " ORDER BY created_at DESC LIMIT 10";

    const [totalRes, typeRes, recentRes] = await Promise.all([
      db.query(totalQuery, params),
      db.query(typeQuery, params),
      db.query(recentQuery, params),
    ]);

    return {
      totalEvents: parseInt(totalRes.rows[0].count, 10),
      byType: typeRes.rows,
      recentEvents: recentRes.rows,
    };
  },

  async purgeOldEvents(daysToKeep = 90): Promise<number> {
    const query = `DELETE FROM wallet_events WHERE created_at < NOW() - make_interval(days => $1) RETURNING id`;
    const { rows } = await db.query(query, [daysToKeep]);
    return rows.length;
  },
};

