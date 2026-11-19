import {
  SessionTemplateModel,
  SessionTemplateRecord,
  CreateSessionTemplatePayload,
} from "../models/session-template.model";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import { ErrorCode } from "../errors/error-codes";

export interface CreateTemplateData {
  creatorId: string;
  name: string;
  description: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimatedDurationMinutes: number;
  sections: Array<{
    title: string;
    description: string;
    durationMinutes: number;
    orderIndex: number;
    type: "discussion" | "exercise" | "presentation" | "review" | "break";
  }>;
  learningObjectives: string[];
  tags: string[];
  isPublic?: boolean;
}

export interface TemplateUsageStats {
  templateId: string;
  usageCount: number;
  avgRating: number | null;
  recentBookings: number;
}

export const SessionTemplatesService = {
  async createTemplate(data: CreateTemplateData): Promise<SessionTemplateRecord> {
    // Validate sections have sequential order indices
    const sortedSections = [...data.sections].sort((a, b) => a.orderIndex - b.orderIndex);
    for (let i = 0; i < sortedSections.length; i++) {
      if (sortedSections[i].orderIndex !== i) {
        throw createError(ErrorCode.VALIDATION_ERROR, 400);
      }
    }

    // Validate total duration matches sum of section durations
    const totalSectionDuration = sortedSections.reduce(
      (sum, s) => sum + s.durationMinutes,
      0,
    );
    if (Math.abs(totalSectionDuration - data.estimatedDurationMinutes) > 5) {
      logger.warn("Template section durations don't match estimated duration", {
        estimated: data.estimatedDurationMinutes,
        actual: totalSectionDuration,
      });
    }

    const template = await SessionTemplateModel.create({
      creatorId: data.creatorId,
      name: data.name,
      description: data.description,
      category: data.category,
      difficulty: data.difficulty,
      estimatedDurationMinutes: data.estimatedDurationMinutes,
      sections: sortedSections,
      learningObjectives: data.learningObjectives,
      tags: data.tags,
      isPublic: data.isPublic,
    });

    logger.info("Session template created", {
      templateId: template.id,
      creatorId: data.creatorId,
      name: data.name,
      category: data.category,
    });

    return template;
  },

  async getTemplateById(templateId: string): Promise<SessionTemplateRecord> {
    const template = await SessionTemplateModel.findById(templateId);
    if (!template) {
      throw createError(ErrorCode.SESSION_TEMPLATE_NOT_FOUND, 404);
    }
    return template;
  },

  async getCreatorTemplates(
    creatorId: string,
    filters?: { category?: string; difficulty?: string; page?: number; limit?: number },
  ): Promise<{ templates: SessionTemplateRecord[]; total: number }> {
    return SessionTemplateModel.findByCreatorId(creatorId, filters);
  },

  async getPublicTemplates(
    filters?: { category?: string; difficulty?: string; search?: string; page?: number; limit?: number },
  ): Promise<{ templates: SessionTemplateRecord[]; total: number }> {
    const cacheKey = `templates:public:${JSON.stringify(filters || {})}`;
    const cached = await CacheService.get<{ templates: SessionTemplateRecord[]; total: number }>(cacheKey);
    if (cached) return cached;

    const result = await SessionTemplateModel.findPublicTemplates(filters);
    await CacheService.set(cacheKey, result, 300); // 5 min cache
    return result;
  },

  async updateTemplate(
    templateId: string,
    creatorId: string,
    data: Partial<CreateTemplateData>,
  ): Promise<SessionTemplateRecord> {
    const template = await this.getTemplateById(templateId);

    if (template.creator_id !== creatorId) {
      throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
    }

    const updateData: Parameters<typeof SessionTemplateModel.update>[1] = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.difficulty !== undefined) updateData.difficulty = data.difficulty;
    if (data.estimatedDurationMinutes !== undefined) {
      updateData.estimatedDurationMinutes = data.estimatedDurationMinutes;
    }
    if (data.sections !== undefined) {
      const sorted = [...data.sections].sort((a, b) => a.orderIndex - b.orderIndex);
      updateData.sections = sorted.map((s, i) => ({
        ...s,
        id: `section-${i + 1}`,
      }));
    }
    if (data.learningObjectives !== undefined) {
      updateData.learningObjectives = data.learningObjectives;
    }
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;

    const updated = await SessionTemplateModel.update(templateId, updateData);
    if (!updated) {
      throw createError(ErrorCode.SESSION_TEMPLATE_UPDATE_FAILED, 500);
    }

    // Invalidate public templates cache
    await CacheService.del("templates:public:*");

    logger.info("Session template updated", { templateId, creatorId });
    return updated;
  },

  async deleteTemplate(templateId: string, creatorId: string): Promise<void> {
    const template = await this.getTemplateById(templateId);

    if (template.creator_id !== creatorId) {
      throw createError(ErrorCode.AUTHZ_FORBIDDEN, 403);
    }

    if (template.usage_count > 0) {
      throw createError(ErrorCode.SESSION_TEMPLATE_HAS_USAGE, 400);
    }

    const deleted = await SessionTemplateModel.delete(templateId);
    if (!deleted) {
      throw createError(ErrorCode.SESSION_TEMPLATE_DELETE_FAILED, 500);
    }

    await CacheService.del("templates:public:*");
    logger.info("Session template deleted", { templateId, creatorId });
  },

  async recordTemplateUsage(templateId: string): Promise<void> {
    await SessionTemplateModel.incrementUsageCount(templateId);
    // Invalidate cache
    await CacheService.del("templates:public:*");
  },

  async getTemplateCategories(): Promise<{ category: string; count: number }[]> {
    return SessionTemplateModel.getTemplatesByCategory();
  },

  async cloneTemplate(
    templateId: string,
    newCreatorId: string,
    customizations?: {
      name?: string;
      description?: string;
      isPublic?: boolean;
    },
  ): Promise<SessionTemplateRecord> {
    const source = await this.getTemplateById(templateId);

    const cloned = await SessionTemplateModel.create({
      creatorId: newCreatorId,
      name: customizations?.name || `${source.name} (Copy)`,
      description: customizations?.description || source.description,
      category: source.category,
      difficulty: source.difficulty,
      estimatedDurationMinutes: source.estimated_duration_minutes,
      sections: source.sections.map((s) => ({
        title: s.title,
        description: s.description,
        durationMinutes: s.durationMinutes,
        orderIndex: s.orderIndex,
        type: s.type,
      })),
      learningObjectives: source.learning_objectives,
      tags: source.tags,
      isPublic: customizations?.isPublic ?? false,
    });

    logger.info("Session template cloned", {
      sourceTemplateId: templateId,
      clonedTemplateId: cloned.id,
      newCreatorId,
    });

    return cloned;
  },
};
