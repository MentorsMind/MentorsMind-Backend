import pool from "../config/database";

export interface Payment {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  stellar_tx_hash: string | null;
  created_at: Date;
}

export const PaymentModel = {
  async initializeTable(): Promise<void> {
    // This is now handled by transactions table, but keeping the method for compatibility
    const query = `
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USD',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        stellar_tx_hash TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(query);
  },

  async findByUserId(userId: string): Promise<Payment[]> {
    const query =
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC;";
    const { rows } = await pool.query<Payment>(query, [userId]);
    return rows;
  },

  /**
   * Bulk fetch payments for multiple users.
   * Returns one array per requested userId.
   */
  async findByUserIds(userIds: string[]): Promise<Payment[]> {
    if (userIds.length === 0) return [];
    const query =
      "SELECT * FROM transactions WHERE user_id = ANY($1) ORDER BY user_id, created_at DESC;";
    const { rows } = await pool.query<Payment>(query, [userIds]);
    return rows;
  },

  async findEarningsByMentorId(
    mentorId: string,
    from?: string,
    to?: string,
  ): Promise<any[]> {
    let query = `
      SELECT p.*, s.start_time as session_time
      FROM transactions p
      JOIN sessions s ON p.user_id = s.learner_id
      WHERE s.mentor_id = $1
    `;
    const params: any[] = [mentorId];

    if (from) {
      params.push(from);
      query += ` AND p.created_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      query += ` AND p.created_at <= $${params.length}`;
    }

    query += " ORDER BY p.created_at DESC;";
    const { rows } = await pool.query(query, params);
    return rows;
  },
};
