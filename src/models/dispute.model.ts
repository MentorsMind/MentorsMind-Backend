import pool from '../config/database';

export interface DisputeRecord {
  id: string;
  transaction_id: string;
  reporter_id: string;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export const DisputeModel = {
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS disputes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID NOT NULL REFERENCES transactions(id),
        reporter_id UUID NOT NULL REFERENCES users(id),
        reason TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        resolution_notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
      CREATE INDEX IF NOT EXISTS idx_disputes_transaction_id ON disputes(transaction_id);
    `;
    await pool.query(query);
  },

  async findAll(limit = 50, offset = 0): Promise<DisputeRecord[]> {
    const { rows } = await pool.query<DisputeRecord>(
      `SELECT * FROM disputes ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  },

  async updateStatus(id: string, status: string, notes?: string): Promise<DisputeRecord | null> {
    const { rows } = await pool.query<DisputeRecord>(
      `UPDATE disputes SET status = $1, resolution_notes = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, notes || null, id]
    );
    return rows[0] || null;
  },

  async countActive(): Promise<number> {
    const { rows } = await pool.query("SELECT COUNT(*) FROM disputes WHERE status = 'open'");
    return parseInt(rows[0].count, 10);
  }
};
