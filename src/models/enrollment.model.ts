import pool from "../config/database";
import { z } from "zod";
import { 
  PathEnrollmentRecord, 
  PathEnrollment, 
  MilestoneProgressRecord,
  MilestoneProgress,
  EnrollmentStatusSchema,
  PaymentStatusSchema,
  MilestoneStatusSchema,
  CreateEnrollmentData,
  UpdateEnrollmentStatusData,
  CompleteMilestoneData
} from "./learning-path.model";

export const EnrollmentModel = {
  async create(
    learningPathId: string, 
    studentId: string, 
    data: CreateEnrollmentData = {}
  ): Promise<PathEnrollmentRecord> {
    const { rows } = await pool.query<PathEnrollmentRecord>(
      `INSERT INTO path_enrollments (
        learning_path_id, student_id, metadata
      ) VALUES ($1, $2, $3) RETURNING *`,
      [learningPathId, studentId, data]
    );
    return rows[0];
  },

  async findById(id: string): Promise<PathEnrollmentRecord | null> {
    const { rows } = await pool.query<PathEnrollmentRecord>(
      `SELECT * FROM path_enrollments WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByStudentAndPath(
    studentId: string, 
    learningPathId: string
  ): Promise<PathEnrollmentRecord | null> {
    const { rows } = await pool.query<PathEnrollmentRecord>(
      `SELECT * FROM path_enrollments WHERE student_id = $1 AND learning_path_id = $2`,
      [studentId, learningPathId]
    );
    return rows[0] || null;
  },

  async findByStudentId(
    studentId: string,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ enrollments: PathEnrollmentRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const offset = (page - 1) * limit;

    let whereClause = 'student_id = $1';
    const params: any[] = [studentId];
    let paramIndex = 2;

    if (filters?.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    const [dataResult, countResult] = await Promise.all([
      pool.query<PathEnrollmentRecord>(
        `SELECT * FROM path_enrollments WHERE ${whereClause} 
         ORDER BY enrolled_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM path_enrollments WHERE ${whereClause}`,
        params
      )
    ]);

    return {
      enrollments: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  },

  async findByLearningPathId(
    learningPathId: string,
    filters?: {
      status?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ enrollments: PathEnrollmentRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const offset = (page - 1) * limit;

    let whereClause = 'learning_path_id = $1';
    const params: any[] = [learningPathId];
    let paramIndex = 2;

    if (filters?.status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    const [dataResult, countResult] = await Promise.all([
      pool.query<PathEnrollmentRecord>(
        `SELECT * FROM path_enrollments WHERE ${whereClause} 
         ORDER BY enrolled_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM path_enrollments WHERE ${whereClause}`,
        params
      )
    ]);

    return {
      enrollments: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  },

  async updateStatus(
    id: string, 
    data: UpdateEnrollmentStatusData
  ): Promise<PathEnrollmentRecord | null> {
    const fields: string[] = ['status = $2'];
    const values: any[] = [id, data.status];
    let idx = 3;

    // Set appropriate timestamp based on status
    switch (data.status) {
      case 'active':
        if (!await this.hasStarted(id)) {
          fields.push(`started_at = CURRENT_TIMESTAMP`);
        }
        fields.push(`paused_at = NULL`, `cancelled_at = NULL`);
        break;
      case 'paused':
        fields.push(`paused_at = CURRENT_TIMESTAMP`);
        break;
      case 'completed':
        fields.push(`completed_at = CURRENT_TIMESTAMP`, `progress_percentage = 100`);
        break;
      case 'cancelled':
        fields.push(`cancelled_at = CURRENT_TIMESTAMP`);
        if (data.reason) {
          fields.push(`cancellation_reason = $${idx++}`);
          values.push(data.reason);
        }
        break;
    }

    const { rows } = await pool.query<PathEnrollmentRecord>(
      `UPDATE path_enrollments SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async updateProgress(
    id: string, 
    progressPercentage: number, 
    currentMilestoneId?: string
  ): Promise<PathEnrollmentRecord | null> {
    const { rows } = await pool.query<PathEnrollmentRecord>(
      `UPDATE path_enrollments 
       SET progress_percentage = $2, current_milestone_id = $3 
       WHERE id = $1 RETURNING *`,
      [id, progressPercentage, currentMilestoneId || null]
    );
    return rows[0] || null;
  },

  async updatePaymentStatus(
    id: string, 
    paymentStatus: string, 
    totalPaid?: number
  ): Promise<PathEnrollmentRecord | null> {
    const fields = ['payment_status = $2'];
    const values = [id, paymentStatus];

    if (totalPaid !== undefined) {
      fields.push('total_paid = $3');
      values.push(totalPaid);
    }

    const { rows } = await pool.query<PathEnrollmentRecord>(
      `UPDATE path_enrollments SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async hasStarted(id: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT started_at FROM path_enrollments WHERE id = $1`,
      [id]
    );
    return rows[0]?.started_at !== null;
  },

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM path_enrollments WHERE id = $1`,
      [id]
    );
    return rowCount > 0;
  },

  // Transform database record to API interface
  transformToEnrollment(record: PathEnrollmentRecord): PathEnrollment {
    return {
      id: record.id,
      learningPathId: record.learning_path_id,
      studentId: record.student_id,
      status: record.status as any,
      progressPercentage: record.progress_percentage,
      currentMilestoneId: record.current_milestone_id || undefined,
      enrolledAt: record.enrolled_at.toISOString(),
      startedAt: record.started_at?.toISOString(),
      completedAt: record.completed_at?.toISOString(),
      pausedAt: record.paused_at?.toISOString(),
      cancelledAt: record.cancelled_at?.toISOString(),
      cancellationReason: record.cancellation_reason || undefined,
      paymentStatus: record.payment_status as any,
      totalPaid: record.total_paid,
      metadata: record.metadata,
    };
  }
};

export const MilestoneProgressModel = {
  async create(
    enrollmentId: string, 
    milestoneId: string
  ): Promise<MilestoneProgressRecord> {
    const { rows } = await pool.query<MilestoneProgressRecord>(
      `INSERT INTO milestone_progress (enrollment_id, milestone_id) 
       VALUES ($1, $2) RETURNING *`,
      [enrollmentId, milestoneId]
    );
    return rows[0];
  },

  async findById(id: string): Promise<MilestoneProgressRecord | null> {
    const { rows } = await pool.query<MilestoneProgressRecord>(
      `SELECT * FROM milestone_progress WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByEnrollmentAndMilestone(
    enrollmentId: string, 
    milestoneId: string
  ): Promise<MilestoneProgressRecord | null> {
    const { rows } = await pool.query<MilestoneProgressRecord>(
      `SELECT * FROM milestone_progress WHERE enrollment_id = $1 AND milestone_id = $2`,
      [enrollmentId, milestoneId]
    );
    return rows[0] || null;
  },

  async findByEnrollmentId(enrollmentId: string): Promise<MilestoneProgressRecord[]> {
    const { rows } = await pool.query<MilestoneProgressRecord>(
      `SELECT mp.* FROM milestone_progress mp
       JOIN milestones m ON mp.milestone_id = m.id
       WHERE mp.enrollment_id = $1 
       ORDER BY m.order_index ASC`,
      [enrollmentId]
    );
    return rows;
  },

  async updateProgress(
    enrollmentId: string,
    milestoneId: string,
    progressPercentage: number,
    timeSpentMinutes?: number
  ): Promise<MilestoneProgressRecord | null> {
    // Get or create progress record
    let progress = await this.findByEnrollmentAndMilestone(enrollmentId, milestoneId);
    
    if (!progress) {
      progress = await this.create(enrollmentId, milestoneId);
    }

    const fields = ['progress_percentage = $3'];
    const values = [enrollmentId, milestoneId, progressPercentage];
    let idx = 4;

    // Update status based on progress
    if (progressPercentage === 0) {
      fields.push(`status = 'not_started'`);
    } else if (progressPercentage === 100) {
      fields.push(`status = 'completed'`, `completed_at = CURRENT_TIMESTAMP`);
    } else {
      fields.push(`status = 'in_progress'`);
      if (progress.started_at === null) {
        fields.push(`started_at = CURRENT_TIMESTAMP`);
      }
    }

    if (timeSpentMinutes !== undefined) {
      fields.push(`time_spent_minutes = time_spent_minutes + $${idx++}`);
      values.push(timeSpentMinutes);
    }

    const { rows } = await pool.query<MilestoneProgressRecord>(
      `UPDATE milestone_progress 
       SET ${fields.join(', ')} 
       WHERE enrollment_id = $1 AND milestone_id = $2 RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async completeMilestone(
    enrollmentId: string,
    milestoneId: string,
    data: CompleteMilestoneData
  ): Promise<MilestoneProgressRecord | null> {
    // Get or create progress record
    let progress = await this.findByEnrollmentAndMilestone(enrollmentId, milestoneId);
    
    if (!progress) {
      progress = await this.create(enrollmentId, milestoneId);
    }

    const fields = [
      'status = $3',
      'progress_percentage = 100',
      'completed_at = CURRENT_TIMESTAMP'
    ];
    const values = [enrollmentId, milestoneId, 'completed'];
    let idx = 4;

    if (progress.started_at === null) {
      fields.push(`started_at = CURRENT_TIMESTAMP`);
    }

    if (data.completionData) {
      fields.push(`completion_data = $${idx++}`);
      values.push(data.completionData);
    }

    if (data.notes) {
      fields.push(`notes = $${idx++}`);
      values.push(data.notes);
    }

    const { rows } = await pool.query<MilestoneProgressRecord>(
      `UPDATE milestone_progress 
       SET ${fields.join(', ')} 
       WHERE enrollment_id = $1 AND milestone_id = $2 RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async skipMilestone(
    enrollmentId: string,
    milestoneId: string,
    reason?: string
  ): Promise<MilestoneProgressRecord | null> {
    // Get or create progress record
    let progress = await this.findByEnrollmentAndMilestone(enrollmentId, milestoneId);
    
    if (!progress) {
      progress = await this.create(enrollmentId, milestoneId);
    }

    const fields = ['status = $3'];
    const values = [enrollmentId, milestoneId, 'skipped'];

    if (reason) {
      fields.push('notes = $4');
      values.push(reason);
    }

    const { rows } = await pool.query<MilestoneProgressRecord>(
      `UPDATE milestone_progress 
       SET ${fields.join(', ')} 
       WHERE enrollment_id = $1 AND milestone_id = $2 RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async getCompletionStats(enrollmentId: string): Promise<{
    totalMilestones: number;
    completedMilestones: number;
    inProgressMilestones: number;
    notStartedMilestones: number;
    skippedMilestones: number;
  }> {
    const { rows } = await pool.query(
      `SELECT 
        COUNT(*) as total_milestones,
        COUNT(CASE WHEN mp.status = 'completed' THEN 1 END) as completed_milestones,
        COUNT(CASE WHEN mp.status = 'in_progress' THEN 1 END) as in_progress_milestones,
        COUNT(CASE WHEN mp.status = 'not_started' OR mp.status IS NULL THEN 1 END) as not_started_milestones,
        COUNT(CASE WHEN mp.status = 'skipped' THEN 1 END) as skipped_milestones
       FROM path_enrollments pe
       JOIN milestones m ON pe.learning_path_id = m.learning_path_id
       LEFT JOIN milestone_progress mp ON pe.id = mp.enrollment_id AND m.id = mp.milestone_id
       WHERE pe.id = $1`,
      [enrollmentId]
    );

    const stats = rows[0];
    return {
      totalMilestones: parseInt(stats.total_milestones, 10),
      completedMilestones: parseInt(stats.completed_milestones, 10),
      inProgressMilestones: parseInt(stats.in_progress_milestones, 10),
      notStartedMilestones: parseInt(stats.not_started_milestones, 10),
      skippedMilestones: parseInt(stats.skipped_milestones, 10),
    };
  },

  async calculateOverallProgress(enrollmentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT 
        COUNT(*) as total_milestones,
        COALESCE(AVG(CASE WHEN mp.status = 'completed' THEN 100 
                          WHEN mp.status = 'skipped' THEN 100 
                          ELSE COALESCE(mp.progress_percentage, 0) END), 0) as avg_progress
       FROM path_enrollments pe
       JOIN milestones m ON pe.learning_path_id = m.learning_path_id
       LEFT JOIN milestone_progress mp ON pe.id = mp.enrollment_id AND m.id = mp.milestone_id
       WHERE pe.id = $1`,
      [enrollmentId]
    );

    return Math.round(parseFloat(rows[0].avg_progress) * 100) / 100;
  },

  // Transform database record to API interface
  transformToProgress(record: MilestoneProgressRecord): MilestoneProgress {
    return {
      id: record.id,
      enrollmentId: record.enrollment_id,
      milestoneId: record.milestone_id,
      status: record.status as any,
      progressPercentage: record.progress_percentage,
      startedAt: record.started_at?.toISOString(),
      completedAt: record.completed_at?.toISOString(),
      timeSpentMinutes: record.time_spent_minutes,
      completionData: record.completion_data,
      notes: record.notes || undefined,
      createdAt: record.created_at.toISOString(),
      updatedAt: record.updated_at.toISOString(),
    };
  }
};