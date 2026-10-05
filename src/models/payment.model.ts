import { db } from "../config/database";
import { Logger } from "../utils/logger.utils";
import { withCurrentTenantFilter } from "../utils/tenant-context.utils";

export interface Payment {
  id: string;
  tenant_id: string | null;
  user_id: string;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  stellar_tx_hash: string | null;
  created_at: Date;
}

export const PaymentModel = {
  async findByUserId(userId: string): Promise<Payment[]> {
    const { query, params } = withCurrentTenantFilter(
      "SELECT * FROM transactions WHERE user_id = $1",
      [userId],
    );
    const { rows } = await db.query(`${query} ORDER BY created_at DESC`, params);
    return rows;
  },

  /**
   * Bulk fetch payments for multiple users.
   * Returns one array per requested userId.
   */
  async findByUserIds(userIds: string[]): Promise<Payment[]> {
    if (userIds.length === 0) return [];
    const { query, params } = withCurrentTenantFilter(
      "SELECT * FROM transactions WHERE user_id = ANY($1)",
      [userIds],
    );
    const { rows } = await db.query(
      `${query} ORDER BY user_id, created_at DESC`,
      params,
    );
    return rows;
  },

  async findEarningsByMentorId(
    mentorId: string,
    from?: string,
    to?: string,
  ): Promise<any[]> {
    let baseQuery = `
      SELECT p.*, s.start_time as session_time
      FROM transactions p
      JOIN sessions s ON p.user_id = s.learner_id
      WHERE s.mentor_id = $1
    `;
    const baseParams: unknown[] = [mentorId];

    if (from) {
      baseParams.push(from);
      baseQuery += ` AND p.created_at >= $${baseParams.length}`;
    }
    if (to) {
      baseParams.push(to);
      baseQuery += ` AND p.created_at <= $${baseParams.length}`;
    }

    // Apply tenant filter
    const { query, params } = withCurrentTenantFilter(
      baseQuery,
      baseParams,
      "p.tenant_id",
    );

    const { rows } = await db.query(`${query} ORDER BY p.created_at DESC`, params);
    return rows;
  },

  /**
   * Delete payments (transactions) older than given number of years.
   * Returns number of records deleted.
   *
   * Note: This is a system maintenance operation â€” it runs across all tenants
   * intentionally and should only be called from admin/maintenance contexts.
   */
  async deleteOlderThanYears(years: number): Promise<number> {
    try {
      const { rowCount } = await db.query(
        `DELETE FROM transactions WHERE created_at < NOW() - ($1::int * INTERVAL '1 year') RETURNING id;`,
        [years],
      );

      const deleted = rowCount ?? 0;
      if (deleted > 0) {
        logger.info("PaymentModel: deleted old payments", { years, deleted });
      }
      return deleted;
    } catch (error) {
      logger.error("Failed to delete old payments:", error);
      return 0;
    }
  },
};

