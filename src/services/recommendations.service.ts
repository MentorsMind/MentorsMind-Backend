import pool from '../config/database';

export class RecommendationService {
  static async getRecommendedMentors(learnerId: string) {
    const query = `
      SELECT 
        u.id, 
        u.full_name AS name,
        u.bio, 
        u.hourly_rate, 
        u.expertise, 
        u.average_rating,
        u.total_reviews,
        u.years_of_experience
      FROM users u
      WHERE u.role = 'mentor' 
        AND u.status = 'active'
        AND u.is_available = true
        AND u.deleted_at IS NULL
        AND u.expertise && (
          SELECT COALESCE(array_agg(DISTINCT unnest), ARRAY[]::text[])
          FROM learner_goals
          WHERE learner_id = $1
        )
      ORDER BY u.average_rating DESC NULLS LAST, u.total_reviews DESC
      LIMIT 5
    `;
    const result = await pool.query(query, [learnerId]);
    return result.rows;
  }
}
