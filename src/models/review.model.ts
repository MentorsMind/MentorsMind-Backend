import pool from "../config/database";

export interface Review {
  id: string;
  session_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
}

export const ReviewModel = {
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL,
        reviewer_id UUID NOT NULL,
        reviewee_id UUID NOT NULL,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(query);
  },

  async findByUserId(userId: string): Promise<Review[]> {
    const query =
      "SELECT * FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1 ORDER BY created_at DESC;";
    const { rows } = await pool.query<Review>(query, [userId]);
    return rows;
  },

  /**
   * Bulk fetch reviews for multiple users.
   * A review can belong to a user as either reviewer or reviewee.
   */
  async findByUserIds(userIds: string[]): Promise<Review[]> {
    if (userIds.length === 0) return [];
    const query =
      "SELECT * FROM reviews WHERE reviewer_id = ANY($1) OR reviewee_id = ANY($1) ORDER BY created_at DESC;";
    const { rows } = await pool.query<Review>(query, [userIds]);
    return rows;
  },
};
