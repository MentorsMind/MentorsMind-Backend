import pool from '../config/database';

export type DisputeStatus = 'open' | 'under_review' | 'resolved';

export interface DisputeRecord {
  id: string;
  transaction_id: string;
  reporter_id: string;
  reason: string;
  status: DisputeStatus;
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DisputeEvidenceRecord {
  id: string;
  dispute_id: string;
  submitter_id: string;
  text_content: string | null;
  file_url: string | null;
  created_at: Date;
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

      CREATE TABLE IF NOT EXISTS dispute_evidence (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dispute_id UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
        submitter_id UUID NOT NULL REFERENCES users(id),
        text_content TEXT,
        file_url VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute_id ON dispute_evidence(dispute_id);
    `;
    await pool.query(query);
  },

  async create(data: { transaction_id: string, reporter_id: string, reason: string }): Promise<DisputeRecord> {
    const { rows } = await pool.query<DisputeRecord>(
      `INSERT INTO disputes (transaction_id, reporter_id, reason)
       VALUES ($1, $2, $3) RETURNING *`,
      [data.transaction_id, data.reporter_id, data.reason]
    );
    return rows[0];
  },

  async findById(id: string): Promise<DisputeRecord | null> {
    const { rows } = await pool.query<DisputeRecord>(
      `SELECT * FROM disputes WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByUserId(userId: string): Promise<DisputeRecord[]> {
    const { rows } = await pool.query<DisputeRecord>(
      `SELECT * FROM disputes WHERE reporter_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async findAll(limit = 50, offset = 0): Promise<DisputeRecord[]> {
    const { rows } = await pool.query<DisputeRecord>(
      `SELECT * FROM disputes ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  },

  async findUnresolvedOlderThanDays(days: number): Promise<DisputeRecord[]> {
    const { rows } = await pool.query<DisputeRecord>(
      `SELECT * FROM disputes
       WHERE status != 'resolved'
       AND created_at < NOW() - make_interval(days => $1)`,
      [days]
    );
    return rows;
  },

  async updateStatus(id: string, status: DisputeStatus, notes?: string): Promise<DisputeRecord | null> {
    const { rows } = await pool.query<DisputeRecord>(
      `UPDATE disputes SET status = $1, resolution_notes = COALESCE($2, resolution_notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, notes || null, id]
    );
    return rows[0] || null;
  },

  async countActive(): Promise<number> {
    const { rows } = await pool.query("SELECT COUNT(*) FROM disputes WHERE status = 'open' OR status = 'under_review'");
    return parseInt(rows[0].count, 10);
  },

  async addEvidence(data: { dispute_id: string, submitter_id: string, text_content?: string, file_url?: string }): Promise<DisputeEvidenceRecord> {
    const { rows } = await pool.query<DisputeEvidenceRecord>(
      `INSERT INTO dispute_evidence (dispute_id, submitter_id, text_content, file_url)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.dispute_id, data.submitter_id, data.text_content || null, data.file_url || null]
    );
    return rows[0];
  },

  async getEvidence(disputeId: string): Promise<DisputeEvidenceRecord[]> {
    const { rows } = await pool.query<DisputeEvidenceRecord>(
      `SELECT * FROM dispute_evidence WHERE dispute_id = $1 ORDER BY created_at ASC`,
      [disputeId]
    );
    return rows;
  }
};
