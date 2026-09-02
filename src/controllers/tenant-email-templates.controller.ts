import { Request, Response } from "express";
import { ResponseUtil } from "../utils/response.utils";
import { TenantEmailTemplatesModel } from "../models/tenant-email-templates.model";
import { TenantEmailTemplateVersionsModel } from "../models/tenant-email-template-versions.model";
import { TemplateEngineService } from "../services/template-engine.service";
import pool from "../config/database";
import { redis } from "../config/redis";
import { logger } from "../utils/logger";

function extractVariablesFromContent(content: string): string[] {
  const matches = content.match(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g) || [];
  const vars = new Set<string>();
  matches.forEach((m) => {
    const v = m.replace(/\{\{|\}\}/g, "").trim();
    vars.add(v);
  });
  return Array.from(vars);
}

function validateVariablesAgainstSchema(
  used: string[],
  schema: any,
): { valid: boolean; missing: string[] } {
  if (!schema) return { valid: true, missing: [] };

  // Accept either array of variable names or JSON schema with properties
  let allowed: string[] = [];
  if (Array.isArray(schema)) allowed = schema;
  else if (schema.properties && typeof schema.properties === "object")
    allowed = Object.keys(schema.properties);
  else if (schema.type === "object" && schema.properties)
    allowed = Object.keys(schema.properties);

  const missing = used.filter((u) => !allowed.includes(u));
  return { valid: missing.length === 0, missing };
}

export const TenantEmailTemplatesController = {
  async createOrUpdate(req: Request, res: Response) {
    const body = req.body;
    const required = [
      "tenant_id",
      "template_name",
      "html_template",
      "text_template",
    ];
    for (const f of required) {
      if (!body[f]) return ResponseUtil.error(res, `${f} is required`, 400);
    }

    const usedVars = [
      ...extractVariablesFromContent(body.subject_template || ""),
      ...extractVariablesFromContent(body.html_template || ""),
      ...extractVariablesFromContent(body.text_template || ""),
    ];

    const { valid, missing } = validateVariablesAgainstSchema(
      usedVars,
      body.variables_schema,
    );
    if (!valid) {
      return ResponseUtil.error(
        res,
        `Undefined variables referenced: ${missing.join(", ")}`,
        422,
      );
    }

    try {
      // Save previous version if exists
      const existing = await TenantEmailTemplatesModel.get(
        body.tenant_id,
        body.template_name,
      );
      if (existing) {
        await TenantEmailTemplateVersionsModel.insertVersion({
          tenant_id: existing.tenant_id,
          template_name: existing.template_name,
          subject_template: existing.subject_template,
          html_template: existing.html_template,
          text_template: existing.text_template,
          variables_schema: existing.variables_schema,
        });
      }

      const saved = await TenantEmailTemplatesModel.createOrUpdate({
        tenant_id: body.tenant_id,
        template_name: body.template_name,
        subject_template: body.subject_template,
        html_template: body.html_template,
        text_template: body.text_template,
        variables_schema: body.variables_schema,
        is_active: body.is_active ?? true,
      });

      // prune versions to last 5
      await TenantEmailTemplateVersionsModel.pruneToLimit(
        body.tenant_id,
        body.template_name,
        5,
      );

      // invalidate redis cache
      try {
        await redis.del(`template:${body.tenant_id}:${body.template_name}`);
      } catch (err) {
        logger.warn("Failed to invalidate template cache", err);
      }

      return ResponseUtil.success(res, saved, "Template saved");
    } catch (error) {
      logger.error("Failed to save tenant template", error);
      return ResponseUtil.error(res, "Failed to save template");
    }
  },

  async list(req: Request, res: Response) {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId)
      return ResponseUtil.error(res, "tenant_id query parameter required", 400);

    try {
      const list = await TenantEmailTemplatesModel.listForTenant(tenantId);
      return ResponseUtil.success(res, list);
    } catch (error) {
      logger.error("Failed to list tenant templates", error);
      return ResponseUtil.error(res, "Failed to list templates");
    }
  },

  async preview(req: Request, res: Response) {
    const tenantId =
      (req.body.tenant_id as string) || (req.query.tenant_id as string);
    const templateName = req.params.name;
    const sampleData = req.body.sample_data || {};

    if (!tenantId) return ResponseUtil.error(res, "tenant_id is required", 400);

    try {
      const tpl = await TemplateEngineService.resolveTemplate(
        templateName,
        tenantId,
      );
      if (!tpl) return ResponseUtil.notFound(res, "Template not found");

      const rendered = await TemplateEngineService.renderEmail(
        { name: templateName, tenantId: Array.isArray(tenantId) ? tenantId[0] : tenantId },
        sampleData,
      );
      return ResponseUtil.success(res, rendered);
    } catch (error) {
      logger.error("Failed to render preview", error);
      return ResponseUtil.error(res, "Failed to render preview");
    }
  },

  async rollback(req: Request, res: Response) {
    const tenantId = req.body.tenant_id as string;
    const templateName = req.params.name;
    const versionId = Number(req.body.version_id);

    if (!tenantId || !versionId)
      return ResponseUtil.error(
        res,
        "tenant_id and version_id are required",
        400,
      );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const version =
        await TenantEmailTemplateVersionsModel.getVersionById(versionId);
      if (
        !version ||
        version.tenant_id !== tenantId ||
        version.template_name !== templateName
      ) {
        await client.query("ROLLBACK");
        return ResponseUtil.notFound(res, "Version not found");
      }

      // restore into tenant_email_templates
      const query = `
        INSERT INTO tenant_email_templates (tenant_id, template_name, subject_template, html_template, text_template, variables_schema, is_active, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW())
        ON CONFLICT (tenant_id, template_name) DO UPDATE SET
          subject_template = EXCLUDED.subject_template,
          html_template = EXCLUDED.html_template,
          text_template = EXCLUDED.text_template,
          variables_schema = EXCLUDED.variables_schema,
          is_active = TRUE,
          updated_at = NOW();
      `;
      await client.query(query, [
        tenantId,
        templateName,
        version.subject_template,
        version.html_template,
        version.text_template,
        version.variables_schema,
      ]);

      await client.query("COMMIT");

      // invalidate cache
      try {
        await redis.del(`template:${tenantId}:${templateName}`);
      } catch (err) {
        logger.warn("Failed to invalidate cache after rollback", err);
      }

      return ResponseUtil.success(
        res,
        { restored: true },
        "Template rolled back",
      );
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("Rollback failed", error);
      return ResponseUtil.error(res, "Rollback failed");
    } finally {
      client.release();
    }
  },
};
