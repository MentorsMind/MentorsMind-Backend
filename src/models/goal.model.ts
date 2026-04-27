import db from '../config/db';

export interface Goal {
  id: string;
  learner_id: string;
  title: string;
  description?: string;
  target_date?: string;
  progress: number;
  status: 'active' | 'completed' | 'paused';
  created_at: string;
  updated_at: string;
}

export class GoalModel {
  static async create(data: Partial<Goal>): Promise<Goal> {
    const { learner_id, title, description, target_date } = data;
    const result = await db.query(
      `INSERT INTO goals (learner_id, title, description, target_date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [learner_id, title, description, target_date],
    );
    return result.rows[0];
  }

  static async findByLearnerId(learnerId: string): Promise<Goal[]> {
    const result = await db.query(
      `SELECT * FROM goals 
       WHERE learner_id = $1 
       ORDER BY target_date ASC NULLS LAST, created_at DESC`,
      [learnerId],
    );
    return result.rows;
  }

  static async findById(id: string): Promise<Goal | null> {
    const result = await db.query(
      'SELECT * FROM goals WHERE id = $1',
      [id],
    );
    return result.rows[0] || null;
  }

  static async update(id: string, data: Partial<Goal>): Promise<Goal | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const updatableFields = ['title', 'description', 'target_date', 'progress', 'status'];
    
    for (const field of updatableFields) {
      if ((data as any)[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push((data as any)[field]);
      }
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const result = await db.query(
      `UPDATE goals SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<boolean> {
    const result = await db.query(
      'DELETE FROM goals WHERE id = $1',
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
       ORDER BY b.scheduled_start DESC`,
      [goalId],
    );
    return result.rows;
  }
}
