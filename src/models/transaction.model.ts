import pool from '../config/database';

export interface TransactionRecord {
  id: string;
  user_id: string;
  amount: string;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  stellar_tx_hash: string | null;
  type: 'deposit' | 'withdrawal' | 'payment';
  created_at: Date;
  updated_at: Date;
}

export const TransactionModel = {
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        amount DECIMAL(20, 7) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        stellar_tx_hash VARCHAR(64),
        type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    `;
    await pool.query(query);
  },

  async findAll(limit = 50, offset = 0): Promise<TransactionRecord[]> {
    const { rows } = await pool.query<TransactionRecord>(
      `SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  },

  async count(): Promise<number> {
    const { rows } = await pool.query('SELECT COUNT(*) FROM transactions');
    return parseInt(rows[0].count, 10);
  },

  async getStats(): Promise<{ total_volume: string; count: number }> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_volume, COUNT(*) as count FROM transactions WHERE status = 'completed'`
    );
    return {
      total_volume: rows[0].total_volume,
      count: parseInt(rows[0].count, 10),
    };
  }
};
