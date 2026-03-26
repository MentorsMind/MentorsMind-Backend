import pool from '../config/database';

export interface WalletEvent {
  id: string;
  user_id: string;
  event_type: 'balance_check' | 'payout_request' | 'trustline_add' | 'transaction_view' | 'wallet_created' | 'earnings_view';
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export const WalletEventModel = {
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS wallet_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_events_user_id ON wallet_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_events_event_type ON wallet_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_wallet_events_created_at ON wallet_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_wallet_events_user_type ON wallet_events(user_id, event_type);
    `;
    await pool.query(query);
  },

  async create(eventData: {
    userId: string;
    eventType: WalletEvent['event_type'];
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
      const { rows } = await pool.query<WalletEvent>(query, values);
      return rows[0] || null;
    } catch (error) {
      console.error('Failed to create wallet event:', error);
      return null;
    }
  },

  async findByUserId(userId: string, limit = 50, offset = 0): Promise<WalletEvent[]> {
    const query = `
      SELECT * FROM wallet_events 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3;
    `;
    const { rows } = await pool.query<WalletEvent>(query, [userId, limit, offset]);
    return rows;
  },

  async findByEventType(
    eventType: WalletEvent['event_type'], 
    limit = 50, 
    offset = 0
  ): Promise<WalletEvent[]> {
    const query = `
      SELECT * FROM wallet_events 
      WHERE event_type = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3;
    `;
    const { rows } = await pool.query<WalletEvent>(query, [eventType, limit, offset]);
    return rows;
  },

  async findByUserAndType(
    userId: string, 
    eventType: WalletEvent['event_type'],
    limit = 50, 
    offset = 0
  ): Promise<WalletEvent[]> {
    const query = `
      SELECT * FROM wallet_events
      WHERE user_id = $1 AND event_type = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4;
    `;
    const { rows } = await pool.query<WalletEvent>(query, [userId, eventType, limit, offset]);
    return rows;
  },

  async getEventStats(userId?: string): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    recentActivity: WalletEvent[];
  }> {
    let totalQuery = 'SELECT COUNT(*) FROM wallet_events';
    let typeQuery = 'SELECT event_type, COUNT(*) as count FROM wallet_events';
    let recentQuery = 'SELECT * FROM wallet_events';
    const params: any[] = [];

    if (userId) {
      totalQuery += ' WHERE user_id = $1';
      typeQuery += ' WHERE user_id = $1';
      recentQuery += ' WHERE user_id = $1';
      params.push(userId);
    }

    typeQuery += ' GROUP BY event_type';
    recentQuery += ' ORDER BY created_at DESC LIMIT 10';

    const [totalResult, typeResult, recentResult] = await Promise.all([
      pool.query(totalQuery, params),
      pool.query(typeQuery, params),
      pool.query<WalletEvent>(recentQuery, params),
    ]);

    const eventsByType: Record<string, number> = {};
    typeResult.rows.forEach(row => {
      eventsByType[row.event_type] = parseInt(row.count, 10);
    });

    return {
      totalEvents: parseInt(totalResult.rows[0].count, 10),
      eventsByType,
      recentActivity: recentResult.rows,
    };
  },

  async deleteOldEvents(daysToKeep = 90): Promise<number> {
    const query = `
      DELETE FROM wallet_events
      WHERE created_at < NOW() - make_interval(days => $1)
      RETURNING id;
    `;
    const { rows } = await pool.query(query, [daysToKeep]);
    return rows.length;
  },
};