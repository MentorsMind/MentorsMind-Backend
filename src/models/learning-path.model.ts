import pool from "../config/database";
import { z } from "zod";

// Validation schemas
export const DifficultyLevelSchema = z.enum(['beginner', 'intermediate', 'advanced', 'expert']);
export const PricingModelSchema = z.enum(['total', 'milestone', 'subscription']);
export const EnrollmentStatusSchema = z.enum(['active', 'paused', 'completed', 'cancelled']);
export const PaymentStatusSchema = z.enum(['pending', 'paid', 'refunded', 'failed', 'partial']);
export const MilestoneStatusSchema = z.enum(['not_started', 'in_progress', 'completed', 'skipped']);
export const SessionTypeSchema = z.enum(['milestone', 'support', 'assessment']);
export const PrerequisiteTypeSchema = z.enum(['milestone', 'skill', 'assessment']);
export const CertificateTypeSchema = z.enum(['milestone', 'path']);

// Core interfaces
export interface LearningPath {
  id: string;
  mentorId: string;
  title: string;
  description?: string;
  estimatedDurationHours: number;
  difficultyLevel: z.infer<typeof DifficultyLevelSchema>;
  totalPrice?: number;
  pricingModel: z.infer<typeof PricingModelSchema>;
  currency: string;
  isPublished: boolean;
  isTemplate: boolean;
  templateId?: string;
  enrolledCount: number;
  completionCount: number;
  rating: number;
  reviewCount: number;
  tags: string[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  milestones?: Milestone[];
}

export interface Milestone {
  id: string;
  learningPathId: string;
  title: string;
  description?: string;
  orderIndex: number;
  estimatedDurationHours: number;
  price?: number;
  learningObjectives: string[];
  completionCriteria: CompletionCriteria;
  resources: Resource[];
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
  prerequisites?: Prerequisite[];
}

export interface Prerequisite {
  id: string;
  milestoneId: string;
  prerequisiteType: z.infer<typeof PrerequisiteTypeSchema>;
  prerequisiteId?: string;
  skillName?: string;
  assessmentCriteria?: Record<string, any>;
  isRequired: boolean;
  createdAt: string;
}

export interface PathEnrollment {
  id: string;
  learningPathId: string;
  studentId: string;
  status: z.infer<typeof EnrollmentStatusSchema>;
  progressPercentage: number;
  currentMilestoneId?: string;
  enrolledAt: string;
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  paymentStatus: z.infer<typeof PaymentStatusSchema>;
  totalPaid: number;
  metadata: Record<string, any>;
}

export interface MilestoneProgress {
  id: string;
  enrollmentId: string;
  milestoneId: string;
  status: z.infer<typeof MilestoneStatusSchema>;
  progressPercentage: number;
  startedAt?: string;
  completedAt?: string;
  timeSpentMinutes: number;
  completionData: Record<string, any>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneSession {
  id: string;
  milestoneId: string;
  bookingId: string;
  sessionType: z.infer<typeof SessionTypeSchema>;
  contributesToCompletion: boolean;
  completionWeight: number;
  createdAt: string;
}

export interface CompletionCertificate {
  id: string;
  enrollmentId?: string;
  milestoneId?: string;
  certificateType: z.infer<typeof CertificateTypeSchema>;
  certificateData: CertificateData;
  verificationHash: string;
  blockchainTxHash?: string;
  issuedAt: string;
  expiresAt?: string;
  isRevoked: boolean;
  revokedAt?: string;
  revocationReason?: string;
}

export interface PrerequisiteOverride {
  id: string;
  mentorId: string;
  studentId: string;
  milestoneId: string;
  prerequisiteId: string;
  reason: string;
  overriddenAt: string;
}

export interface PathReview {
  id: string;
  learningPathId: string;
  studentId: string;
  enrollmentId: string;
  rating: number;
  reviewText?: string;
  isAnonymous: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PathAnalytics {
  id: string;
  learningPathId: string;
  date: string;
  newEnrollments: number;
  activeStudents: number;
  completions: number;
  dropouts: number;
  avgProgressPercentage: number;
  avgTimeToCompleteHours: number;
  revenue: number;
  createdAt: string;
}

// Supporting interfaces
export interface CompletionCriteria {
  type: 'automatic' | 'manual' | 'assessment' | 'project';
  requirements: {
    sessionsRequired?: number;
    assessmentScore?: number;
    projectSubmission?: boolean;
    mentorApproval?: boolean;
  };
  description: string;
}

export interface Resource {
  id: string;
  type: 'document' | 'video' | 'link' | 'exercise';
  title: string;
  url?: string;
  content?: string;
  metadata: Record<string, any>;
}

export interface CertificateData {
  studentName: string;
  mentorName: string;
  pathTitle: string;
  milestoneTitle?: string;
  completionDate: string;
  skills: string[];
  verificationUrl: string;
}

export interface Achievement {
  id: string;
  type: 'milestone_completed' | 'streak' | 'fast_learner' | 'perfectionist';
  title: string;
  description: string;
  earnedAt: string;
  metadata: Record<string, any>;
}

export interface StudentProgress {
  enrollment: PathEnrollment;
  milestoneProgress: MilestoneProgress[];
  currentMilestone?: Milestone;
  nextMilestone?: Milestone;
  completedMilestones: number;
  totalMilestones: number;
  estimatedTimeRemaining: number;
  achievements: Achievement[];
}

export interface ValidationResult {
  isValid: boolean;
  missingPrerequisites: Prerequisite[];
  overrides: PrerequisiteOverride[];
  canProceed: boolean;
  message: string;
}

// Database record interfaces (snake_case for DB compatibility)
export interface LearningPathRecord {
  id: string;
  mentor_id: string;
  title: string;
  description?: string;
  estimated_duration_hours: number;
  difficulty_level: string;
  total_price?: number;
  pricing_model: string;
  currency: string;
  is_published: boolean;
  is_template: boolean;
  template_id?: string;
  enrolled_count: number;
  completion_count: number;
  rating: number;
  review_count: number;
  tags: string[];
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

export interface MilestoneRecord {
  id: string;
  learning_path_id: string;
  title: string;
  description?: string;
  order_index: number;
  estimated_duration_hours: number;
  price?: number;
  learning_objectives: string[];
  completion_criteria: Record<string, any>;
  resources: Record<string, any>[];
  is_required: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PathEnrollmentRecord {
  id: string;
  learning_path_id: string;
  student_id: string;
  status: string;
  progress_percentage: number;
  current_milestone_id?: string;
  enrolled_at: Date;
  started_at?: Date;
  completed_at?: Date;
  paused_at?: Date;
  cancelled_at?: Date;
  cancellation_reason?: string;
  payment_status: string;
  total_paid: number;
  metadata: Record<string, any>;
}

export interface MilestoneProgressRecord {
  id: string;
  enrollment_id: string;
  milestone_id: string;
  status: string;
  progress_percentage: number;
  started_at?: Date;
  completed_at?: Date;
  time_spent_minutes: number;
  completion_data: Record<string, any>;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

// Validation schemas for API requests
export const CreateLearningPathSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  estimatedDurationHours: z.number().int().min(1).max(1000),
  difficultyLevel: DifficultyLevelSchema,
  totalPrice: z.number().min(0).optional(),
  pricingModel: PricingModelSchema.default('total'),
  currency: z.string().default('XLM'),
  tags: z.array(z.string()).default([]),
  milestones: z.array(z.object({
    title: z.string().min(1).max(255),
    description: z.string().optional(),
    estimatedDurationHours: z.number().int().min(1),
    price: z.number().min(0).optional(),
    learningObjectives: z.array(z.string()),
    completionCriteria: z.object({
      type: z.enum(['automatic', 'manual', 'assessment', 'project']),
      requirements: z.object({
        sessionsRequired: z.number().int().min(0).optional(),
        assessmentScore: z.number().min(0).max(100).optional(),
        projectSubmission: z.boolean().optional(),
        mentorApproval: z.boolean().optional(),
      }),
      description: z.string(),
    }),
    resources: z.array(z.object({
      id: z.string(),
      type: z.enum(['document', 'video', 'link', 'exercise']),
      title: z.string(),
      url: z.string().url().optional(),
      content: z.string().optional(),
      metadata: z.record(z.any()).default({}),
    })).default([]),
    isRequired: z.boolean().default(true),
  })).min(1),
});

export const UpdateLearningPathSchema = CreateLearningPathSchema.partial();

export const CreateEnrollmentSchema = z.object({
  paymentMethod: z.string().optional(),
  promoCode: z.string().optional(),
});

export const UpdateEnrollmentStatusSchema = z.object({
  status: EnrollmentStatusSchema,
  reason: z.string().optional(),
});

export const CompleteMilestoneSchema = z.object({
  completionData: z.record(z.any()).optional(),
  notes: z.string().optional(),
});

export const CreatePrerequisiteOverrideSchema = z.object({
  studentId: z.string().uuid(),
  prerequisiteId: z.string().uuid(),
  reason: z.string().min(1),
});

export const CreatePathReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  reviewText: z.string().optional(),
  isAnonymous: z.boolean().default(false),
});

// Type exports for API
export type CreateLearningPathData = z.infer<typeof CreateLearningPathSchema>;
export type UpdateLearningPathData = z.infer<typeof UpdateLearningPathSchema>;
export type CreateEnrollmentData = z.infer<typeof CreateEnrollmentSchema>;
export type UpdateEnrollmentStatusData = z.infer<typeof UpdateEnrollmentStatusSchema>;
export type CompleteMilestoneData = z.infer<typeof CompleteMilestoneSchema>;
export type CreatePrerequisiteOverrideData = z.infer<typeof CreatePrerequisiteOverrideSchema>;
export type CreatePathReviewData = z.infer<typeof CreatePathReviewSchema>;

// Database model class
export const LearningPathModel = {
  async initializeTable(): Promise<void> {
    // Tables are created via migrations, this is a placeholder for consistency
    // with existing model pattern
  },

  async create(data: CreateLearningPathData & { mentorId: string }): Promise<LearningPathRecord> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create the learning path
      const { rows: pathRows } = await client.query<LearningPathRecord>(
        `INSERT INTO learning_paths (
          mentor_id, title, description, estimated_duration_hours, 
          difficulty_level, total_price, pricing_model, currency, tags, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          data.mentorId,
          data.title,
          data.description || null,
          data.estimatedDurationHours,
          data.difficultyLevel,
          data.totalPrice || null,
          data.pricingModel,
          data.currency,
          data.tags,
          {}
        ]
      );

      const learningPath = pathRows[0];

      // Create milestones
      for (let i = 0; i < data.milestones.length; i++) {
        const milestone = data.milestones[i];
        await client.query(
          `INSERT INTO milestones (
            learning_path_id, title, description, order_index, 
            estimated_duration_hours, price, learning_objectives, 
            completion_criteria, resources, is_required
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            learningPath.id,
            milestone.title,
            milestone.description || null,
            i,
            milestone.estimatedDurationHours,
            milestone.price || null,
            milestone.learningObjectives,
            milestone.completionCriteria,
            milestone.resources,
            milestone.isRequired
          ]
        );
      }

      await client.query('COMMIT');
      return learningPath;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async findById(id: string): Promise<LearningPathRecord | null> {
    const { rows } = await pool.query<LearningPathRecord>(
      `SELECT * FROM learning_paths WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] || null;
  },

  async findByMentorId(
    mentorId: string,
    filters?: {
      isPublished?: boolean;
      isTemplate?: boolean;
      page?: number;
      limit?: number;
    }
  ): Promise<{ paths: LearningPathRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const offset = (page - 1) * limit;

    let whereClause = 'mentor_id = $1 AND deleted_at IS NULL';
    const params: any[] = [mentorId];
    let paramIndex = 2;

    if (filters?.isPublished !== undefined) {
      whereClause += ` AND is_published = $${paramIndex}`;
      params.push(filters.isPublished);
      paramIndex++;
    }

    if (filters?.isTemplate !== undefined) {
      whereClause += ` AND is_template = $${paramIndex}`;
      params.push(filters.isTemplate);
      paramIndex++;
    }

    const [dataResult, countResult] = await Promise.all([
      pool.query<LearningPathRecord>(
        `SELECT * FROM learning_paths WHERE ${whereClause} 
         ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM learning_paths WHERE ${whereClause}`,
        params
      )
    ]);

    return {
      paths: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  },

  async update(
    id: string,
    data: Partial<UpdateLearningPathData>
  ): Promise<LearningPathRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.estimatedDurationHours !== undefined) {
      fields.push(`estimated_duration_hours = $${idx++}`);
      values.push(data.estimatedDurationHours);
    }
    if (data.difficultyLevel !== undefined) {
      fields.push(`difficulty_level = $${idx++}`);
      values.push(data.difficultyLevel);
    }
    if (data.totalPrice !== undefined) {
      fields.push(`total_price = $${idx++}`);
      values.push(data.totalPrice);
    }
    if (data.pricingModel !== undefined) {
      fields.push(`pricing_model = $${idx++}`);
      values.push(data.pricingModel);
    }
    if (data.tags !== undefined) {
      fields.push(`tags = $${idx++}`);
      values.push(data.tags);
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);

    const { rows } = await pool.query<LearningPathRecord>(
      `UPDATE learning_paths SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE learning_paths SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return rowCount > 0;
  },

  async publish(id: string): Promise<LearningPathRecord | null> {
    const { rows } = await pool.query<LearningPathRecord>(
      `UPDATE learning_paths SET is_published = true WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id]
    );
    return rows[0] || null;
  },

  async unpublish(id: string): Promise<LearningPathRecord | null> {
    const { rows } = await pool.query<LearningPathRecord>(
      `UPDATE learning_paths SET is_published = false WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id]
    );
    return rows[0] || null;
  },

  async findPublished(filters?: {
    difficultyLevel?: string;
    tags?: string[];
    mentorId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ paths: LearningPathRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const offset = (page - 1) * limit;

    let whereClause = 'is_published = true AND deleted_at IS NULL';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.difficultyLevel) {
      whereClause += ` AND difficulty_level = $${paramIndex}`;
      params.push(filters.difficultyLevel);
      paramIndex++;
    }

    if (filters?.tags && filters.tags.length > 0) {
      whereClause += ` AND tags && $${paramIndex}`;
      params.push(filters.tags);
      paramIndex++;
    }

    if (filters?.mentorId) {
      whereClause += ` AND mentor_id = $${paramIndex}`;
      params.push(filters.mentorId);
      paramIndex++;
    }

    const [dataResult, countResult] = await Promise.all([
      pool.query<LearningPathRecord>(
        `SELECT * FROM learning_paths WHERE ${whereClause} 
         ORDER BY rating DESC, enrolled_count DESC, created_at DESC 
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM learning_paths WHERE ${whereClause}`,
        params
      )
    ]);

    return {
      paths: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10)
    };
  }
};