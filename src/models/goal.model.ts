import db from '../config/database';

export interface Goal {
  id: string;
  learner_id: string;
  title: string;
  description?: string;
  target_date?: string;
  progress: number;
  status: 'active' | 'completed' | 'paused';
  reminder_sent_7d: boolean;
  reminder_sent_3d: boolean;
  reminder_sent_1d: boolean;
  overdue_notified: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoalProgressLog {
  id: string;
  goal_id: string;
  progress: number;
  notes?: string;
  created_at: string;
}

export type GoalReminderType = '7d' | '3d' | '1d' | 'overdue';

export interface GoalReminderCandidate extends Goal {
  learner_email: string;
  learner_first_name: string | null;
  learner_last_name: string | null;
}

export interface AtRiskGoal extends Goal {
  days_until_deadline: number;
}

export interface GoalMentorSuggestion {
  id: string;
  first_name: string;
  last_name: string;
  expertise: string[] | null;
  hourly_rate: number | null;
  average_rating: number | null;
  total_sessions_completed: number | null;
  is_available: boolean;
  session_goal_alignment: number;
}

export class GoalModel {
  static async create(data: Partial<Goal>): Promise<Goal> {
    const { learner_id, title, description, target_date } = data;
    const result = await db.query(
      `INSERT INTO learner_goals (learner_id, title, description, target_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [learner_id, title, description, target_date],
    );
    return result.rows[0];
  }

  static async findByLearnerId(learnerId: string): Promise<Goal[]> {
    const result = await db.query(
      `SELECT * FROM learner_goals 
       WHERE learner_id = $1 
       ORDER BY target_date ASC NULLS LAST, created_at DESC`,
      [learnerId],
    );
    return result.rows;
  }

  static async findById(id: string): Promise<Goal | null> {
    const result = await db.query(
      'SELECT * FROM learner_goals WHERE id = $1',
      [id],
    );
    return result.rows[0] || null;
  }

  static async update(id: string, data: Partial<Goal>): Promise<Goal | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const updatableFields = [
      'title',
      'description',
      'target_date',
      'progress',
      'status',
      'reminder_sent_7d',
      'reminder_sent_3d',
      'reminder_sent_1d',
      'overdue_notified',
    ];
    
    for (const field of updatableFields) {
      if ((data as any)[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push((data as any)[field]);
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const result = await db.query(
      `UPDATE learner_goals SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await db.query(
      'DELETE FROM learner_goals WHERE id = $1',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async linkBooking(goalId: string, bookingId: string): Promise<void> {
    await db.query(
      `INSERT INTO goal_bookings (goal_id, booking_id) 
       VALUES ($1, $2) 
       ON CONFLICT DO NOTHING`,
      [goalId, bookingId],
    );
  }

  static async getLinkedBookings(goalId: string): Promise<any[]> {
    const result = await db.query(
      `SELECT b.* FROM bookings b
       JOIN goal_bookings gb ON b.id = gb.booking_id
       WHERE gb.goal_id = $1
       ORDER BY b.scheduled_at DESC`,
      [goalId],
    );
    return result.rows;
  }

  static async logProgress(goalId: string, progress: number, notes?: string): Promise<GoalProgressLog> {
    const result = await db.query(
      `INSERT INTO goal_progress_logs (goal_id, progress, notes)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [goalId, progress, notes],
    );

    // Update the parent goal's progress and updated_at timestamp
    await db.query(
      'UPDATE learner_goals SET progress = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [progress, goalId],
    );

    return result.rows[0];
  }

  static async getProgressLogs(goalId: string): Promise<GoalProgressLog[]> {
    const result = await db.query(
      `SELECT * FROM goal_progress_logs
       WHERE goal_id = $1
       ORDER BY created_at DESC`,
      [goalId],
    );
    return result.rows;
  }

  static async findAtRiskGoals(learnerId: string): Promise<AtRiskGoal[]> {
    const result = await db.query(
      `SELECT *,
              (target_date - CURRENT_DATE) AS days_until_deadline
         FROM learner_goals
        WHERE learner_id = $1
          AND status = 'active'
          AND target_date IS NOT NULL
          AND progress < 30
          AND target_date >= CURRENT_DATE
          AND target_date < CURRENT_DATE + 14
        ORDER BY target_date ASC, progress ASC, created_at DESC`,
      [learnerId],
    );

    return result.rows;
  }

  static async findGoalsForReminder(
    reminderType: GoalReminderType,
  ): Promise<GoalReminderCandidate[]> {
    const conditionsByType: Record<GoalReminderType, string> = {
      '7d': `g.target_date = CURRENT_DATE + 7
             AND g.reminder_sent_7d = FALSE`,
      '3d': `g.target_date = CURRENT_DATE + 3
             AND g.reminder_sent_3d = FALSE`,
      '1d': `g.target_date = CURRENT_DATE + 1
             AND g.reminder_sent_1d = FALSE`,
      overdue: `g.target_date < CURRENT_DATE
                AND g.overdue_notified = FALSE`,
    };

    const result = await db.query(
      `SELECT g.*,
              u.email AS learner_email,
              u.first_name AS learner_first_name,
              u.last_name AS learner_last_name
         FROM learner_goals g
         JOIN users u ON u.id = g.learner_id
        WHERE g.status = 'active'
          AND u.is_active = TRUE
          AND g.target_date IS NOT NULL
          AND ${conditionsByType[reminderType]}
        ORDER BY g.target_date ASC, g.progress ASC, g.created_at DESC`,
    );

    return result.rows;
  }

  static async markReminderSent(
    goalId: string,
    reminderType: GoalReminderType,
  ): Promise<void> {
    const columnByType: Record<GoalReminderType, string> = {
      '7d': 'reminder_sent_7d',
      '3d': 'reminder_sent_3d',
      '1d': 'reminder_sent_1d',
      overdue: 'overdue_notified',
    };

    await db.query(
      `UPDATE learner_goals
          SET ${columnByType[reminderType]} = TRUE,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [goalId],
    );
  }

  static async findBestMentorSuggestion(
    keywords: string[],
  ): Promise<GoalMentorSuggestion | null> {
    if (keywords.length === 0) {
      return null;
    }

    const result = await db.query(
      `SELECT u.id,
              u.first_name,
              u.last_name,
              u.expertise,
              u.hourly_rate,
              u.average_rating,
              u.total_sessions_completed,
              u.is_available,
              COALESCE((
                SELECT COUNT(*)
                  FROM unnest(COALESCE(u.expertise, '{}'::text[])) AS exp
                 WHERE EXISTS (
                   SELECT 1
                     FROM unnest($1::text[]) AS keyword
                    WHERE lower(exp) LIKE '%' || keyword || '%'
                       OR keyword LIKE '%' || lower(exp) || '%'
                 )
              ), 0)::numeric / $2::numeric AS session_goal_alignment
         FROM users u
        WHERE u.role = 'mentor'
          AND u.is_active = TRUE
          AND EXISTS (
            SELECT 1
              FROM unnest(COALESCE(u.expertise, '{}'::text[])) AS exp
             WHERE EXISTS (
               SELECT 1
                 FROM unnest($1::text[]) AS keyword
                WHERE lower(exp) LIKE '%' || keyword || '%'
                   OR keyword LIKE '%' || lower(exp) || '%'
             )
          )
        ORDER BY session_goal_alignment DESC,
                 u.is_available DESC,
                 COALESCE(u.average_rating, 0) DESC,
                 COALESCE(u.total_sessions_completed, 0) DESC
        LIMIT 1`,
      [keywords, keywords.length],
    );

    return result.rows[0] || null;
  }
}
