import pool from "../config/database";
import { Logger } from "../utils/logger.utils";

export interface TenantEmailTemplateVersionRecord {
  id: number;
  tenant_id: string;
  template_name: string;
  subject_template?: string;
  html_template: string;
  text_template: string;
  variables_schema?: any;
  versioned_at: Date;
}

export const TenantEmailTemplateVersionsModel = {
  async insertVersion(
    rec: Omit<TenantEmailTemplateVersionRecord, "id" | "versioned_at">,
  ): Promise<TenantEmailTemplateVersionRecord | null> {
    const query = `
      INSERT INTO tenant_email_template_versions (tenant_id, template_name, subject_template, html_template, text_template, variables_schema)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *;
    `;

    const values = [
      rec.tenant_id,
      rec.template_name,
      rec.subject_template,
      rec.html_template,
      rec.text_template,
      rec.variables_schema || null,
    ];

    try {
      const { rows } = await pool.query<TenantEmailTemplateVersionRecord>(
        query,
        values,
      );
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to insert template version:", error);
      return null;
    }
  },

  async listVersions(
    tenantId: string,
    templateName: string,
    limit = 5,
  ): Promise<TenantEmailTemplateVersionRecord[]> {
    const query = `SELECT * FROM tenant_email_template_versions WHERE tenant_id = $1 AND template_name = $2 ORDER BY versioned_at DESC LIMIT $3`;
    try {
      const { rows } = await pool.query<TenantEmailTemplateVersionRecord>(
        query,
        [tenantId, templateName, limit],
      );
      return rows;
    } catch (error) {
      logger.error("Failed to list template versions:", error);
      return [];
    }
  },

  async getVersionById(
    id: number,
  ): Promise<TenantEmailTemplateVersionRecord | null> {
    const query = `SELECT * FROM tenant_email_template_versions WHERE id = $1`;
    try {
      const { rows } = await pool.query<TenantEmailTemplateVersionRecord>(
        query,
        [id],
      );
      return rows[0] || null;
    } catch (error) {
      logger.error("Failed to get template version by id:", error);
      return null;
    }
  },

  async pruneToLimit(
    tenantId: string,
    templateName: string,
    keep = 5,
  ): Promise<void> {
    const query = `
      DELETE FROM tenant_email_template_versions
      WHERE id IN (
        SELECT id FROM tenant_email_template_versions
        WHERE tenant_id = $1 AND template_name = $2
        ORDER BY versioned_at DESC
        OFFSET $3
      );
    `;
    try {
      await pool.query(query, [tenantId, templateName, keep]);
    } catch (error) {
      logger.error("Failed to prune template versions:", error);
    }
  },
};

