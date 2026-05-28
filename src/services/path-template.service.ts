import pool from "../config/database";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { LearningPath, CreateLearningPathData } from "../models/learning-path.model";
import { Milestone, CreateMilestoneData } from "../models/milestone.model";

export interface PathTemplate {
  id: string;
  title: string;
  description: string;
  category: string;
  difficultyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  estimatedDurationHours: number;
  tags: string[];
  usageCount: number;
  rating: number;
  reviewCount: number;
  createdBy: string;
  createdByName: string;
  isOfficial: boolean;
  isPublic: boolean;
  version: string;
  milestones: TemplateMillestone[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateMillestone {
  title: string;
  description: string;
  orderIndex: number;
  estimatedDurationHours: number;
  learningObjectives: string[];
  completionCriteria: any;
  resources: any[];
  isRequired: boolean;
  prerequisites?: TemplatePrerequisite[];
}

export interface TemplatePrerequisite {
  prerequisiteType: 'milestone' | 'skill' | 'assessment';
  prerequisiteIndex?: number; // For milestone prerequisites within template
  skillName?: string;
  assessmentCriteria?: Record<string, any>;
  isRequired: boolean;
}

export interface TemplateCategory {
  name: string;
  description: string;
  templateCount: number;
  popularTags: string[];
}

export interface TemplateCustomization {
  templateId: string;
  customizations: {
    title?: string;
    description?: string;
    estimatedDurationHours?: number;
    totalPrice?: number;
    pricingModel?: 'total' | 'milestone' | 'subscription';
    milestoneCustomizations?: Array<{
      index: number;
      title?: string;
      description?: string;
      estimatedDurationHours?: number;
      price?: number;
      learningObjectives?: string[];
      resources?: any[];
    }>;
  };
}

export const PathTemplateService = {
  /**
   * Get all available path templates with filtering
   */
  async getTemplates(filters?: {
    category?: string;
    difficultyLevel?: string;
    tags?: string[];
    search?: string;
    isOfficial?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ templates: PathTemplate[]; total: number; categories: TemplateCategory[] }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const offset = (page - 1) * limit;

    // Build cache key
    const cacheKey = CacheKeys.pathTemplates() + `:${JSON.stringify(filters || {})}`;
    
    // Try cache first
    const cached = await CacheService.get<{ templates: PathTemplate[]; total: number; categories: TemplateCategory[] }>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Build WHERE clause
    let whereClause = "lp.is_template = true AND lp.deleted_at IS NULL";
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.category) {
      whereClause += ` AND lp.metadata->>'category' = $${paramIndex}`;
      params.push(filters.category);
      paramIndex++;
    }

    if (filters?.difficultyLevel) {
      whereClause += ` AND lp.difficulty_level = $${paramIndex}`;
      params.push(filters.difficultyLevel);
      paramIndex++;
    }

    if (filters?.tags && filters.tags.length > 0) {
      whereClause += ` AND lp.tags && $${paramIndex}`;
      params.push(filters.tags);
      paramIndex++;
    }

    if (filters?.search) {
      whereClause += ` AND (lp.title ILIKE $${paramIndex} OR lp.description ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    if (filters?.isOfficial !== undefined) {
      whereClause += ` AND COALESCE((lp.metadata->>'isOfficial')::boolean, false) = $${paramIndex}`;
      params.push(filters.isOfficial);
      paramIndex++;
    }

    // Get templates with creator information
    const templatesQuery = `
      SELECT 
        lp.id, lp.title, lp.description, lp.difficulty_level as "difficultyLevel",
        lp.estimated_duration_hours as "estimatedDurationHours", lp.tags,
        lp.enrolled_count as "usageCount", lp.rating, lp.review_count as "reviewCount",
        lp.mentor_id as "createdBy", lp.metadata, lp.created_at as "createdAt", lp.updated_at as "updatedAt",
        u.first_name || ' ' || u.last_name as "createdByName",
        COALESCE((lp.metadata->>'category')::text, 'General') as category,
        COALESCE((lp.metadata->>'isOfficial')::boolean, false) as "isOfficial",
        COALESCE((lp.metadata->>'isPublic')::boolean, true) as "isPublic",
        COALESCE((lp.metadata->>'version')::text, '1.0.0') as version
      FROM learning_paths lp
      JOIN users u ON lp.mentor_id = u.id
      WHERE ${whereClause}
      ORDER BY lp.rating DESC, lp.enrolled_count DESC, lp.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM learning_paths lp
      WHERE ${whereClause}
    `;

    const [templatesResult, countResult] = await Promise.all([
      pool.query(templatesQuery, [...params, limit, offset]),
      pool.query(countQuery, params)
    ]);

    // Get milestones for each template
    const templates: PathTemplate[] = [];
    for (const template of templatesResult.rows) {
      const milestones = await this.getTemplateMilestones(template.id);
      templates.push({
        ...template,
        milestones
      });
    }

    // Get categories
    const categories = await this.getTemplateCategories();

    const result = {
      templates,
      total: parseInt(countResult.rows[0].total),
      categories
    };

    // Cache for 10 minutes
    await CacheService.set(cacheKey, result, CacheTTL.medium * 2);

    return result;
  },

  /**
   * Get a specific template by ID
   */
  async getTemplate(templateId: string): Promise<PathTemplate | null> {
    const cacheKey = CacheKeys.learningPath(templateId);
    
    // Try cache first
    const cached = await CacheService.get<PathTemplate>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const { rows } = await pool.query(
      `SELECT 
         lp.id, lp.title, lp.description, lp.difficulty_level as "difficultyLevel",
         lp.estimated_duration_hours as "estimatedDurationHours", lp.tags,
         lp.enrolled_count as "usageCount", lp.rating, lp.review_count as "reviewCount",
         lp.mentor_id as "createdBy", lp.metadata, lp.created_at as "createdAt", lp.updated_at as "updatedAt",
         u.first_name || ' ' || u.last_name as "createdByName",
         COALESCE((lp.metadata->>'category')::text, 'General') as category,
         COALESCE((lp.metadata->>'isOfficial')::boolean, false) as "isOfficial",
         COALESCE((lp.metadata->>'isPublic')::boolean, true) as "isPublic",
         COALESCE((lp.metadata->>'version')::text, '1.0.0') as version
       FROM learning_paths lp
       JOIN users u ON lp.mentor_id = u.id
       WHERE lp.id = $1 AND lp.is_template = true AND lp.deleted_at IS NULL`,
      [templateId]
    );

    if (rows.length === 0) {
      return null;
    }

    const template = rows[0];
    const milestones = await this.getTemplateMilestones(templateId);

    const result: PathTemplate = {
      ...template,
      milestones
    };

    // Cache for 30 minutes
    await CacheService.set(cacheKey, result, CacheTTL.long / 2);

    return result;
  },

  /**
   * Create a new path template
   */
  async createTemplate(
    mentorId: string,
    templateData: {
      title: string;
      description: string;
      category: string;
      difficultyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
      estimatedDurationHours: number;
      tags: string[];
      isPublic?: boolean;
      version?: string;
      milestones: TemplateMillestone[];
    }
  ): Promise<PathTemplate> {
    // Create the template learning path
    const { rows: pathRows } = await pool.query(
      `INSERT INTO learning_paths (
         mentor_id, title, description, estimated_duration_hours, difficulty_level,
         tags, is_template, is_published, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, true, true, $7)
       RETURNING id`,
      [
        mentorId,
        templateData.title,
        templateData.description,
        templateData.estimatedDurationHours,
        templateData.difficultyLevel,
        templateData.tags,
        JSON.stringify({
          category: templateData.category,
          isPublic: templateData.isPublic !== false,
          version: templateData.version || '1.0.0',
          isOfficial: false
        })
      ]
    );

    const templateId = pathRows[0].id;

    // Create milestones
    for (const milestone of templateData.milestones) {
      const { rows: milestoneRows } = await pool.query(
        `INSERT INTO milestones (
           learning_path_id, title, description, order_index, estimated_duration_hours,
           learning_objectives, completion_criteria, resources, is_required
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          templateId,
          milestone.title,
          milestone.description,
          milestone.orderIndex,
          milestone.estimatedDurationHours,
          milestone.learningObjectives,
          JSON.stringify(milestone.completionCriteria),
          JSON.stringify(milestone.resources),
          milestone.isRequired
        ]
      );

      const milestoneId = milestoneRows[0].id;

      // Create prerequisites if any
      if (milestone.prerequisites) {
        for (const prereq of milestone.prerequisites) {
          let prerequisiteId = null;
          
          // For milestone prerequisites, find the actual milestone ID
          if (prereq.prerequisiteType === 'milestone' && prereq.prerequisiteIndex !== undefined) {
            const { rows: prereqRows } = await pool.query(
              `SELECT id FROM milestones 
               WHERE learning_path_id = $1 AND order_index = $2`,
              [templateId, prereq.prerequisiteIndex]
            );
            
            if (prereqRows.length > 0) {
              prerequisiteId = prereqRows[0].id;
            }
          }

          await pool.query(
            `INSERT INTO prerequisites (
               milestone_id, prerequisite_type, prerequisite_id, skill_name,
               assessment_criteria, is_required
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              milestoneId,
              prereq.prerequisiteType,
              prerequisiteId,
              prereq.skillName,
              prereq.assessmentCriteria ? JSON.stringify(prereq.assessmentCriteria) : null,
              prereq.isRequired
            ]
          );
        }
      }
    }

    logger.info("Path template created", {
      templateId,
      mentorId,
      title: templateData.title,
      category: templateData.category
    });

    // Invalidate template cache
    await this.invalidateTemplateCache();

    return this.getTemplate(templateId)!;
  },

  /**
   * Customize and create a learning path from template
   */
  async customizeTemplate(
    mentorId: string,
    customization: TemplateCustomization
  ): Promise<LearningPath> {
    const template = await this.getTemplate(customization.templateId);
    if (!template) {
      throw createError("Template not found", 404);
    }

    // Import here to avoid circular dependency
    const { LearningPathService } = await import("./learning-path.service");

    // Prepare learning path data
    const pathData: CreateLearningPathData = {
      title: customization.customizations.title || template.title,
      description: customization.customizations.description || template.description,
      estimatedDurationHours: customization.customizations.estimatedDurationHours || template.estimatedDurationHours,
      difficultyLevel: template.difficultyLevel,
      totalPrice: customization.customizations.totalPrice,
      pricingModel: customization.customizations.pricingModel || 'total',
      tags: template.tags,
      milestones: []
    };

    // Prepare milestones with customizations
    for (let i = 0; i < template.milestones.length; i++) {
      const templateMilestone = template.milestones[i];
      const customMilestone = customization.customizations.milestoneCustomizations?.find(
        c => c.index === i
      );

      const milestoneData: CreateMilestoneData = {
        title: customMilestone?.title || templateMilestone.title,
        description: customMilestone?.description || templateMilestone.description,
        orderIndex: templateMilestone.orderIndex,
        estimatedDurationHours: customMilestone?.estimatedDurationHours || templateMilestone.estimatedDurationHours,
        price: customMilestone?.price,
        learningObjectives: customMilestone?.learningObjectives || templateMilestone.learningObjectives,
        completionCriteria: templateMilestone.completionCriteria,
        resources: customMilestone?.resources || templateMilestone.resources,
        isRequired: templateMilestone.isRequired
      };

      pathData.milestones.push(milestoneData);
    }

    // Create the customized learning path
    const learningPath = await LearningPathService.createLearningPath(mentorId, pathData);

    // Update template usage count
    await pool.query(
      `UPDATE learning_paths 
       SET enrolled_count = enrolled_count + 1 
       WHERE id = $1`,
      [customization.templateId]
    );

    // Set template reference
    await pool.query(
      `UPDATE learning_paths 
       SET template_id = $1 
       WHERE id = $2`,
      [customization.templateId, learningPath.id]
    );

    logger.info("Template customized and learning path created", {
      templateId: customization.templateId,
      newPathId: learningPath.id,
      mentorId
    });

    // Invalidate template cache
    await this.invalidateTemplateCache();

    return learningPath;
  },

  /**
   * Update an existing template
   */
  async updateTemplate(
    templateId: string,
    mentorId: string,
    updates: Partial<{
      title: string;
      description: string;
      category: string;
      tags: string[];
      isPublic: boolean;
      version: string;
    }>
  ): Promise<PathTemplate> {
    // Verify template ownership
    const { rows: ownerRows } = await pool.query(
      `SELECT mentor_id FROM learning_paths 
       WHERE id = $1 AND is_template = true AND deleted_at IS NULL`,
      [templateId]
    );

    if (ownerRows.length === 0) {
      throw createError("Template not found", 404);
    }

    if (ownerRows[0].mentor_id !== mentorId) {
      throw createError("Only template creator can update template", 403);
    }

    // Prepare update fields
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(updates.title);
    }

    if (updates.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(updates.description);
    }

    if (updates.tags !== undefined) {
      fields.push(`tags = $${idx++}`);
      values.push(updates.tags);
    }

    // Update metadata
    const currentTemplate = await this.getTemplate(templateId);
    if (currentTemplate) {
      const newMetadata = { ...currentTemplate.metadata };
      
      if (updates.category !== undefined) {
        newMetadata.category = updates.category;
      }
      if (updates.isPublic !== undefined) {
        newMetadata.isPublic = updates.isPublic;
      }
      if (updates.version !== undefined) {
        newMetadata.version = updates.version;
      }

      fields.push(`metadata = $${idx++}`);
      values.push(JSON.stringify(newMetadata));
    }

    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(templateId);

      await pool.query(
        `UPDATE learning_paths 
         SET ${fields.join(', ')}
         WHERE id = $${idx}`,
        values
      );
    }

    // Invalidate caches
    await this.invalidateTemplateCache();
    await CacheService.del(CacheKeys.learningPath(templateId));

    logger.info("Template updated", {
      templateId,
      mentorId,
      updates: Object.keys(updates)
    });

    return this.getTemplate(templateId)!;
  },

  /**
   * Delete a template
   */
  async deleteTemplate(templateId: string, mentorId: string): Promise<void> {
    // Verify template ownership
    const { rows: ownerRows } = await pool.query(
      `SELECT mentor_id FROM learning_paths 
       WHERE id = $1 AND is_template = true AND deleted_at IS NULL`,
      [templateId]
    );

    if (ownerRows.length === 0) {
      throw createError("Template not found", 404);
    }

    if (ownerRows[0].mentor_id !== mentorId) {
      throw createError("Only template creator can delete template", 403);
    }

    // Check if template is being used
    const { rows: usageRows } = await pool.query(
      `SELECT COUNT(*) as count FROM learning_paths 
       WHERE template_id = $1 AND deleted_at IS NULL`,
      [templateId]
    );

    if (parseInt(usageRows[0].count) > 0) {
      throw createError("Cannot delete template that is being used by learning paths", 400);
    }

    // Soft delete the template
    await pool.query(
      `UPDATE learning_paths 
       SET deleted_at = NOW() 
       WHERE id = $1`,
      [templateId]
    );

    // Invalidate caches
    await this.invalidateTemplateCache();
    await CacheService.del(CacheKeys.learningPath(templateId));

    logger.info("Template deleted", { templateId, mentorId });
  },

  /**
   * Get template categories with statistics
   */
  async getTemplateCategories(): Promise<TemplateCategory[]> {
    const cacheKey = `template_categories`;
    
    // Try cache first
    const cached = await CacheService.get<TemplateCategory[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const { rows } = await pool.query(`
      SELECT 
        COALESCE(metadata->>'category', 'General') as name,
        COUNT(*) as template_count,
        ARRAY_AGG(DISTINCT tag) FILTER (WHERE tag IS NOT NULL) as popular_tags
      FROM learning_paths lp
      CROSS JOIN LATERAL unnest(lp.tags) as tag
      WHERE lp.is_template = true AND lp.deleted_at IS NULL
      GROUP BY COALESCE(metadata->>'category', 'General')
      ORDER BY template_count DESC
    `);

    const categories: TemplateCategory[] = rows.map(row => ({
      name: row.name,
      description: this.getCategoryDescription(row.name),
      templateCount: parseInt(row.template_count),
      popularTags: row.popular_tags?.slice(0, 10) || []
    }));

    // Cache for 1 hour
    await CacheService.set(cacheKey, categories, CacheTTL.long);

    return categories;
  },

  /**
   * Search templates with advanced filtering
   */
  async searchTemplates(query: {
    search?: string;
    category?: string;
    difficultyLevel?: string;
    tags?: string[];
    minRating?: number;
    maxDuration?: number;
    isOfficial?: boolean;
    sortBy?: 'rating' | 'usage' | 'recent' | 'duration';
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{ templates: PathTemplate[]; total: number; facets: any }> {
    // Use the main getTemplates method with enhanced filtering
    const result = await this.getTemplates({
      category: query.category,
      difficultyLevel: query.difficultyLevel,
      tags: query.tags,
      search: query.search,
      isOfficial: query.isOfficial,
      page: query.page,
      limit: query.limit
    });

    // Apply additional filters
    let filteredTemplates = result.templates;

    if (query.minRating) {
      filteredTemplates = filteredTemplates.filter(t => t.rating >= query.minRating!);
    }

    if (query.maxDuration) {
      filteredTemplates = filteredTemplates.filter(t => t.estimatedDurationHours <= query.maxDuration!);
    }

    // Apply sorting
    if (query.sortBy) {
      const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
      
      filteredTemplates.sort((a, b) => {
        switch (query.sortBy) {
          case 'rating':
            return (a.rating - b.rating) * sortOrder;
          case 'usage':
            return (a.usageCount - b.usageCount) * sortOrder;
          case 'recent':
            return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * sortOrder;
          case 'duration':
            return (a.estimatedDurationHours - b.estimatedDurationHours) * sortOrder;
          default:
            return 0;
        }
      });
    }

    // Generate facets for filtering UI
    const facets = {
      categories: result.categories,
      difficultyLevels: this.getDifficultyLevelFacets(result.templates),
      durationRanges: this.getDurationRangeFacets(result.templates),
      ratingRanges: this.getRatingRangeFacets(result.templates)
    };

    return {
      templates: filteredTemplates,
      total: filteredTemplates.length,
      facets
    };
  },

  // Private helper methods

  private async getTemplateMilestones(templateId: string): Promise<TemplateMillestone[]> {
    const { rows } = await pool.query(
      `SELECT 
         title, description, order_index as "orderIndex", estimated_duration_hours as "estimatedDurationHours",
         learning_objectives as "learningObjectives", completion_criteria as "completionCriteria",
         resources, is_required as "isRequired"
       FROM milestones
       WHERE learning_path_id = $1
       ORDER BY order_index`,
      [templateId]
    );

    return rows.map(row => ({
      ...row,
      learningObjectives: row.learningObjectives || [],
      completionCriteria: row.completionCriteria || {},
      resources: row.resources || []
    }));
  },

  private getCategoryDescription(category: string): string {
    const descriptions: Record<string, string> = {
      'Programming': 'Software development and programming languages',
      'Data Science': 'Data analysis, machine learning, and statistics',
      'Design': 'UI/UX design, graphic design, and creative skills',
      'Business': 'Business skills, management, and entrepreneurship',
      'Marketing': 'Digital marketing, content creation, and growth',
      'General': 'General skills and miscellaneous topics'
    };

    return descriptions[category] || 'Various learning topics and skills';
  },

  private getDifficultyLevelFacets(templates: PathTemplate[]): Array<{ level: string; count: number }> {
    const counts: Record<string, number> = {};
    
    templates.forEach(template => {
      counts[template.difficultyLevel] = (counts[template.difficultyLevel] || 0) + 1;
    });

    return Object.entries(counts).map(([level, count]) => ({ level, count }));
  },

  private getDurationRangeFacets(templates: PathTemplate[]): Array<{ range: string; count: number }> {
    const ranges = [
      { range: '0-10 hours', min: 0, max: 10 },
      { range: '10-25 hours', min: 10, max: 25 },
      { range: '25-50 hours', min: 25, max: 50 },
      { range: '50+ hours', min: 50, max: Infinity }
    ];

    return ranges.map(({ range, min, max }) => ({
      range,
      count: templates.filter(t => t.estimatedDurationHours >= min && t.estimatedDurationHours < max).length
    }));
  },

  private getRatingRangeFacets(templates: PathTemplate[]): Array<{ range: string; count: number }> {
    const ranges = [
      { range: '4.5+', min: 4.5 },
      { range: '4.0+', min: 4.0 },
      { range: '3.5+', min: 3.5 },
      { range: '3.0+', min: 3.0 }
    ];

    return ranges.map(({ range, min }) => ({
      range,
      count: templates.filter(t => t.rating >= min).length
    }));
  },

  private async invalidateTemplateCache(): Promise<void> {
    // Invalidate all template-related caches
    const keys = [
      CacheKeys.pathTemplates(),
      'template_categories'
    ];

    await Promise.all(keys.map(key => CacheService.del(key)));
  }
};