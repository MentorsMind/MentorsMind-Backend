import pool from "../config/database";
import { Logger } from "../utils/logger.utils";

export interface TenantEmailTemplateRecord {
  tenant_id: string;
  template_name: string;
  subject_template?: string;
  html_template: string;
  text_template: string;
  variables_schema?: any;
  is_active: boolean;
  updated_at: Date;
}

export interface TenantEmailTemplateInput {
  tenant_id: string;
  template_name: string;
  subject_template?: string;
  html_template: string;
  text_template: string;
  variables_schema?: any;
  is_active?: boolean;
}

export const TenantEmailTemplatesModel = {
  async createOrUpdate(
    input: TenantEmailTemplateInput,
  ): Promise<TenantEmailTemplateRecord | null> {
    const query = `
      INSERT INTO tenant_email_templates (tenant_id, template_name, subject_template, html_template, text_template, variables_schema, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (tenant_id, template_name) DO UPDATE SET
        subject_template = EXCLUDED.subject_template,
        html_template = EXCLUDED.html_template,
        text_template = EXCLUDED.text_template,
        variables_schema = EXCLUDED.variables_schema,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      input.tenant_id,
      input.template_name,
      input.subject_template,
      input.html_template,
      input.text_template,
      input.variables_schema || null,
      input.is_active ?? true,
    ];

    try {
      const { rows } = await pool.query<TenantEmailTemplateRecord>(
        query,
        values,
      );
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to upsert tenant email template:", error);
      return null;
    }
  },

  async get(
    tenantId: string,
    templateName: string,
  ): Promise<TenantEmailTemplateRecord | null> {
    const query = `SELECT * FROM tenant_email_templates WHERE tenant_id = $1 AND template_name = $2 AND is_active = TRUE`;
    try {
      const { rows } = await pool.query<TenantEmailTemplateRecord>(query, [
        tenantId,
        templateName,
      ]);
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to get tenant email template:", error);
      return null;
    }
  },

  async listForTenant(tenantId: string): Promise<TenantEmailTemplateRecord[]> {
    const query = `SELECT * FROM tenant_email_templates WHERE tenant_id = $1 ORDER BY template_name`;
    try {
      const { rows } = await pool.query<TenantEmailTemplateRecord>(query, [
        tenantId,
      ]);
      return rows;
    } catch (error) {
      logger.error("Failed to list tenant email templates:", error);
      return [];
    }
  },

  async delete(tenantId: string, templateName: string): Promise<boolean> {
    const query = `UPDATE tenant_email_templates SET is_active = FALSE, updated_at = NOW() WHERE tenant_id = $1 AND template_name = $2 RETURNING tenant_id`;
    try {
      const { rowCount } = await pool.query(query, [tenantId, templateName]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("Failed to delete tenant email template:", error);
      return false;
    }
  },
};

