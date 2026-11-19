import { db } from "../config/database";
import {
  TenantContext,
  withCurrentTenantFilter,
} from "../utils/tenant-context.utils";

export interface SessionTemplateSection {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  orderIndex: number;
  type: "discussion" | "exercise" | "presentation" | "review" | "break";
}

export interface SessionTemplateRecord {
  id: string;
  tenant_id: string | null;
  creator_id: string;
  name: string;
  description: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimated_duration_minutes: number;
  sections: SessionTemplateSection[];
  learning_objectives: string[];
  tags: string[];
  is_public: boolean;
  usage_count: number;
  avg_rating: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSessionTemplatePayload {
  creatorId: string;
  name: string;
  description: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedDurationMinutes: number;
  sections: Omit<SessionTemplateSection, "id">[];
  learningObjectives: string[];
  tags: string[];
  isPublic?: boolean;
}

export const SessionTemplateModel = {
  async create(
    payload: CreateSessionTemplatePayload,
  ): Promise<SessionTemplateRecord> {
    const tenantId = TenantContext.hasTenantContext()
      ? TenantContext.getTenantId()
      : null;

    const query = `
      INSERT INTO session_templates (
        tenant_id, creator_id, name, description, category, difficulty,
        estimated_duration_minutes, sections, learning_objectives, tags, is_public
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const { rows } = await db.query(query, [
      tenantId,
      payload.creatorId,
      payload.name,
      payload.description,
      payload.category,
      payload.difficulty,
      payload.estimatedDurationMinutes,
      JSON.stringify(payload.sections),
      JSON.stringify(payload.learningObjectives),
      JSON.stringify(payload.tags),
      payload.isPublic ?? false,
    ]);

    return rows[0];
  },

  async findById(id: string): Promise<SessionTemplateRecord | null> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT * FROM session_templates WHERE id = $1`,
      [id],
    );
    const { rows } = await db.query(query, params);
    return rows[0] || null;
  },

  async findByCreatorId(
    creatorId: string,
    filters?: { category?: string; difficulty?: string; page?: number; limit?: number },
  ): Promise<{ templates: SessionTemplateRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = "creator_id = $1";
    const baseParams: unknown[] = [creatorId];
    let paramIndex = 2;

    if (filters?.category) {
      whereClause += ` AND category = $${paramIndex}`;
      baseParams.push(filters.category);
      paramIndex++;
    }

    if (filters?.difficulty) {
      whereClause += ` AND difficulty = $${paramIndex}`;
      baseParams.push(filters.difficulty);
      paramIndex++;
    }

    const { query: baseQuery, params: filteredParams } = withCurrentTenantFilter(
      `SELECT * FROM session_templates WHERE ${whereClause}`,
      baseParams,
    );
    const finalParamIndex = filteredParams.length + 1;

    const { query: countQuery, params: countParams } = withCurrentTenantFilter(
      `SELECT COUNT(*) FROM session_templates WHERE ${whereClause}`,
      baseParams,
    );

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `${baseQuery} ORDER BY created_at DESC LIMIT $${finalParamIndex} OFFSET $${finalParamIndex + 1}`,
        [...filteredParams, limit, offset],
      ),
      db.query(countQuery, countParams),
    ]);

    return {
      templates: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async findPublicTemplates(
    filters?: { category?: string; difficulty?: string; search?: string; page?: number; limit?: number },
  ): Promise<{ templates: SessionTemplateRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    let whereClause = "is_public = true";
    const baseParams: unknown[] = [];
    let paramIndex = 1;

    if (filters?.category) {
      whereClause += ` AND category = $${paramIndex}`;
      baseParams.push(filters.category);
      paramIndex++;
    }

    if (filters?.difficulty) {
      whereClause += ` AND difficulty = $${paramIndex}`;
      baseParams.push(filters.difficulty);
      paramIndex++;
    }

    if (filters?.search) {
      whereClause += ` AND (name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
      baseParams.push(`%${filters.search}%`);
      paramIndex++;
    }

    const { query: baseQuery, params: filteredParams } = withCurrentTenantFilter(
      `SELECT * FROM session_templates WHERE ${whereClause}`,
      baseParams,
    );
    const finalParamIndex = filteredParams.length + 1;

    const { query: countQuery, params: countParams } = withCurrentTenantFilter(
      `SELECT COUNT(*) FROM session_templates WHERE ${whereClause}`,
      baseParams,
    );

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `${baseQuery} ORDER BY usage_count DESC, avg_rating DESC NULLS LAST LIMIT $${finalParamIndex} OFFSET $${finalParamIndex + 1}`,
        [...filteredParams, limit, offset],
      ),
      db.query(countQuery, countParams),
    ]);

    return {
      templates: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async update(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      category: string;
      difficulty: "beginner" | "intermediate" | "advanced";
      estimatedDurationMinutes: number;
      sections: SessionTemplateSection[];
      learningObjectives: string[];
      tags: string[];
      isPublic: boolean;
    }>,
  ): Promise<SessionTemplateRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.category !== undefined) {
      fields.push(`category = $${idx++}`);
      values.push(data.category);
    }
    if (data.difficulty !== undefined) {
      fields.push(`difficulty = $${idx++}`);
      values.push(data.difficulty);
    }
    if (data.estimatedDurationMinutes !== undefined) {
      fields.push(`estimated_duration_minutes = $${idx++}`);
      values.push(data.estimatedDurationMinutes);
    }
    if (data.sections !== undefined) {
      fields.push(`sections = $${idx++}`);
      values.push(JSON.stringify(data.sections));
    }
    if (data.learningObjectives !== undefined) {
      fields.push(`learning_objectives = $${idx++}`);
      values.push(JSON.stringify(data.learningObjectives));
    }
    if (data.tags !== undefined) {
      fields.push(`tags = $${idx++}`);
      values.push(JSON.stringify(data.tags));
    }
    if (data.isPublic !== undefined) {
      fields.push(`is_public = $${idx++}`);
      values.push(data.isPublic);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);

    const baseWhereParams: unknown[] = [...values, id];
    const { query: filteredQuery, params: allParams } = withCurrentTenantFilter(
      `UPDATE session_templates SET ${fields.join(", ")} WHERE id = $${idx}`,
      baseWhereParams,
    );

    const { rows } = await db.query(`${filteredQuery} RETURNING *`, allParams);
    return rows[0] || null;
  },

  async incrementUsageCount(id: string): Promise<void> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE session_templates SET usage_count = usage_count + 1 WHERE id = $1`,
      [id],
    );
    await db.query(query, params);
  },

  async updateAvgRating(id: string, rating: number): Promise<void> {
    const { query, params } = withCurrentTenantFilter(
      `UPDATE session_templates
       SET avg_rating = (
         SELECT COALESCE(AVG(rating), 0)
         FROM template_ratings WHERE template_id = $1
       )
       WHERE id = $1`,
      [id],
    );
    await db.query(query, params);
  },

  async delete(id: string): Promise<boolean> {
    const { query, params } = withCurrentTenantFilter(
      `DELETE FROM session_templates WHERE id = $1 RETURNING id`,
      [id],
    );
    const { rowCount } = await db.query(query, params);
    return (rowCount ?? 0) > 0;
  },

  async getTemplatesByCategory(): Promise<{ category: string; count: number }[]> {
    const { query, params } = withCurrentTenantFilter(
      `SELECT category, COUNT(*) as count FROM session_templates
       WHERE is_public = true
       GROUP BY category ORDER BY count DESC`,
      [],
    );
    const { rows } = await db.query(query, params);
    return rows;
  },
};

export default SessionTemplateModel;
