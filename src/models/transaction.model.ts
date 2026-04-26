import pool from "../config/database";

export interface TransactionRecord {
  id: string;
  user_id: string;
  amount: string;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  stellar_tx_hash: string | null;
  type: "deposit" | "withdrawal" | "payment";
  created_at: Date;
  updated_at: Date;
}

export const TransactionModel = {
  async findAll(limit = 50, offset = 0): Promise<TransactionRecord[]> {
    const { rows } = await pool.query<TransactionRecord>(
      `SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows;
  },

  async count(): Promise<number> {
    const { rows } = await pool.query("SELECT COUNT(*) FROM transactions");
    return parseInt(rows[0].count, 10);
  },

  async getStats(): Promise<{ total_volume: string; count: number }> {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_volume, COUNT(*) as count FROM transactions WHERE status = 'completed'`,
    );
    return {
      total_volume: rows[0].total_volume,
      count: parseInt(rows[0].count, 10),
    };
  },
};
