import pool from "../config/database";
import { z } from "zod";
import { 
  MilestoneRecord, 
  Milestone, 
  Prerequisite, 
  PrerequisiteTypeSchema,
  CompletionCriteria,
  Resource
} from "./learning-path.model";

export interface PrerequisiteRecord {
  id: string;
  milestone_id: string;
  prerequisite_type: string;
  prerequisite_id?: string;
  skill_name?: string;
  assessment_criteria?: Record<string, any>;
  is_required: boolean;
  created_at: Date;
}

// Validation schemas
export const CreateMilestoneSchema = z.object({
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
});

export const UpdateMilestoneSchema = CreateMilestoneSchema.partial();

export const CreatePrerequisiteSchema = z.object({
  prerequisiteType: PrerequisiteTypeSchema,
  prerequisiteId: z.string().uuid().optional(),
  skillName: z.string().optional(),
  assessmentCriteria: z.record(z.any()).optional(),
  isRequired: z.boolean().default(true),
});

export type CreateMilestoneData = z.infer<typeof CreateMilestoneSchema>;
export type UpdateMilestoneData = z.infer<typeof UpdateMilestoneSchema>;
export type CreatePrerequisiteData = z.infer<typeof CreatePrerequisiteSchema>;

export const MilestoneModel = {
  async create(
    learningPathId: string, 
    data: CreateMilestoneData,
    orderIndex?: number
  ): Promise<MilestoneRecord> {
    // If no order index provided, get the next available index
    if (orderIndex === undefined) {
      const { rows: countRows } = await pool.query(
        `SELECT COALESCE(MAX(order_index), -1) + 1 as next_index 
         FROM milestones WHERE learning_path_id = $1`,
        [learningPathId]
      );
      orderIndex = countRows[0].next_index;
    }

    const { rows } = await pool.query<MilestoneRecord>(
      `INSERT INTO milestones (
        learning_path_id, title, description, order_index,
        estimated_duration_hours, price, learning_objectives,
        completion_criteria, resources, is_required
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        learningPathId,
        data.title,
        data.description || null,
        orderIndex,
        data.estimatedDurationHours,
        data.price || null,
        data.learningObjectives,
        data.completionCriteria,
        data.resources,
        data.isRequired
      ]
    );
    return rows[0];
  },

  async findById(id: string): Promise<MilestoneRecord | null> {
    const { rows } = await pool.query<MilestoneRecord>(
      `SELECT * FROM milestones WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async findByLearningPathId(learningPathId: string): Promise<MilestoneRecord[]> {
    const { rows } = await pool.query<MilestoneRecord>(
      `SELECT * FROM milestones WHERE learning_path_id = $1 ORDER BY order_index ASC`,
      [learningPathId]
    );
    return rows;
  },

  async update(id: string, data: UpdateMilestoneData): Promise<MilestoneRecord | null> {
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
    if (data.price !== undefined) {
      fields.push(`price = $${idx++}`);
      values.push(data.price);
    }
    if (data.learningObjectives !== undefined) {
      fields.push(`learning_objectives = $${idx++}`);
      values.push(data.learningObjectives);
    }
    if (data.completionCriteria !== undefined) {
      fields.push(`completion_criteria = $${idx++}`);
      values.push(data.completionCriteria);
    }
    if (data.resources !== undefined) {
      fields.push(`resources = $${idx++}`);
      values.push(data.resources);
    }
    if (data.isRequired !== undefined) {
      fields.push(`is_required = $${idx++}`);
      values.push(data.isRequired);
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);

    const { rows } = await pool.query<MilestoneRecord>(
      `UPDATE milestones SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async delete(id: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get milestone info for reordering
      const { rows: milestoneRows } = await client.query(
        `SELECT learning_path_id, order_index FROM milestones WHERE id = $1`,
        [id]
      );

      if (milestoneRows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const { learning_path_id, order_index } = milestoneRows[0];

      // Delete the milestone
      await client.query(`DELETE FROM milestones WHERE id = $1`, [id]);

      // Reorder remaining milestones
      await client.query(
        `UPDATE milestones 
         SET order_index = order_index - 1 
         WHERE learning_path_id = $1 AND order_index > $2`,
        [learning_path_id, order_index]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async reorder(learningPathId: string, milestoneOrders: { id: string; orderIndex: number }[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const { id, orderIndex } of milestoneOrders) {
        await client.query(
          `UPDATE milestones SET order_index = $1 WHERE id = $2 AND learning_path_id = $3`,
          [orderIndex, id, learningPathId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async findWithPrerequisites(id: string): Promise<(MilestoneRecord & { prerequisites: PrerequisiteRecord[] }) | null> {
    const milestone = await this.findById(id);
    if (!milestone) return null;

    const prerequisites = await this.getPrerequisites(id);
    return { ...milestone, prerequisites };
  },

  async getPrerequisites(milestoneId: string): Promise<PrerequisiteRecord[]> {
    const { rows } = await pool.query<PrerequisiteRecord>(
      `SELECT * FROM prerequisites WHERE milestone_id = $1 ORDER BY created_at ASC`,
      [milestoneId]
    );
    return rows;
  },

  async addPrerequisite(milestoneId: string, data: CreatePrerequisiteData): Promise<PrerequisiteRecord> {
    const { rows } = await pool.query<PrerequisiteRecord>(
      `INSERT INTO prerequisites (
        milestone_id, prerequisite_type, prerequisite_id,
        skill_name, assessment_criteria, is_required
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        milestoneId,
        data.prerequisiteType,
        data.prerequisiteId || null,
        data.skillName || null,
        data.assessmentCriteria || null,
        data.isRequired
      ]
    );
    return rows[0];
  },

  async removePrerequisite(prerequisiteId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM prerequisites WHERE id = $1`,
      [prerequisiteId]
    );
    return rowCount > 0;
  },

  async validatePrerequisiteChain(milestoneId: string): Promise<{ isValid: boolean; circularDependency?: string }> {
    // Check for circular dependencies using recursive CTE
    const { rows } = await pool.query(
      `WITH RECURSIVE dependency_chain AS (
        -- Base case: start with the milestone
        SELECT $1::uuid as milestone_id, 0 as depth, ARRAY[$1::uuid] as path
        
        UNION ALL
        
        -- Recursive case: follow prerequisites
        SELECT 
          p.prerequisite_id::uuid,
          dc.depth + 1,
          dc.path || p.prerequisite_id::uuid
        FROM prerequisites p
        JOIN dependency_chain dc ON p.milestone_id = dc.milestone_id
        WHERE p.prerequisite_type = 'milestone' 
        AND p.prerequisite_id IS NOT NULL
        AND dc.depth < 10 -- Prevent infinite recursion
        AND NOT (p.prerequisite_id::uuid = ANY(dc.path)) -- Detect cycles
      )
      SELECT 
        CASE WHEN EXISTS (
          SELECT 1 FROM dependency_chain 
          WHERE milestone_id = $1::uuid AND depth > 0
        ) THEN false ELSE true END as is_valid,
        (SELECT path FROM dependency_chain WHERE milestone_id = $1::uuid AND depth > 0 LIMIT 1) as circular_path`,
      [milestoneId]
    );

    const result = rows[0];
    return {
      isValid: result.is_valid,
      circularDependency: result.circular_path ? result.circular_path.join(' -> ') : undefined
    };
  },

  async getMilestonesByPath(learningPathId: string, includePrerequisites = false): Promise<Milestone[]> {
    const milestones = await this.findByLearningPathId(learningPathId);
    
    if (!includePrerequisites) {
      return milestones.map(this.transformToMilestone);
    }

    // Fetch prerequisites for all milestones in one query
    const milestoneIds = milestones.map(m => m.id);
    if (milestoneIds.length === 0) return [];

    const { rows: prerequisiteRows } = await pool.query<PrerequisiteRecord>(
      `SELECT * FROM prerequisites WHERE milestone_id = ANY($1) ORDER BY milestone_id, created_at`,
      [milestoneIds]
    );

    // Group prerequisites by milestone
    const prerequisitesByMilestone = prerequisiteRows.reduce((acc, prereq) => {
      if (!acc[prereq.milestone_id]) {
        acc[prereq.milestone_id] = [];
      }
      acc[prereq.milestone_id].push(this.transformToPrerequisite(prereq));
      return acc;
    }, {} as Record<string, Prerequisite[]>);

    return milestones.map(milestone => ({
      ...this.transformToMilestone(milestone),
      prerequisites: prerequisitesByMilestone[milestone.id] || []
    }));
  },

  // Transform database records to API interfaces
  transformToMilestone(record: MilestoneRecord): Milestone {
    return {
      id: record.id,
      learningPathId: record.learning_path_id,
      title: record.title,
      description: record.description || undefined,
      orderIndex: record.order_index,
      estimatedDurationHours: record.estimated_duration_hours,
      price: record.price || undefined,
      learningObjectives: record.learning_objectives,
      completionCriteria: record.completion_criteria as CompletionCriteria,
      resources: record.resources as Resource[],
      isRequired: record.is_required,
      createdAt: record.created_at.toISOString(),
      updatedAt: record.updated_at.toISOString(),
    };
  },

  transformToPrerequisite(record: PrerequisiteRecord): Prerequisite {
    return {
      id: record.id,
      milestoneId: record.milestone_id,
      prerequisiteType: record.prerequisite_type as any,
      prerequisiteId: record.prerequisite_id || undefined,
      skillName: record.skill_name || undefined,
      assessmentCriteria: record.assessment_criteria || undefined,
      isRequired: record.is_required,
      createdAt: record.created_at.toISOString(),
    };
  }
};