import pool from '../config/database';
import { logger } from '../utils/logger';

export interface NotificationTemplateRecord {
  id: string;
  name: string;
  type: 'email' | 'in_app';
  subject?: string;
  html_content: string;
  text_content: string;
  variables: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationTemplateInput {
  id: string;
  name: string;
  type: 'email' | 'in_app';
  subject?: string;
  html_content: string;
  text_content: string;
  variables?: string[];
  is_active?: boolean;
}

/**
 * Notification Templates Model for managing email and in-app notification templates
 */
export const NotificationTemplatesModel = {
  /**
   * Initialize the notification_templates table
   */
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS notification_templates (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(20) NOT NULL,
        subject VARCHAR(255),
        html_content TEXT NOT NULL,
        text_content TEXT NOT NULL,
        variables TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_notification_templates_type ON notification_templates(type);
      CREATE INDEX IF NOT EXISTS idx_notification_templates_active ON notification_templates(is_active);
    `;
    await pool.query(query);
  },

  /**
   * Create a new notification template
   */
  async create(input: NotificationTemplateInput): Promise<NotificationTemplateRecord | null> {
    const query = `
      INSERT INTO notification_templates (id, name, type, subject, html_content, text_content, variables, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

    const values = [
      input.id,
      input.name,
      input.type,
      input.subject,
      input.html_content,
      input.text_content,
      input.variables || [],
      input.is_active ?? true,
    ];

    try {
      const { rows } = await pool.query<NotificationTemplateRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to create notification template:', error);
      return null;
    }
  },

  /**
   * Get a template by ID
   */
  async getById(id: string): Promise<NotificationTemplateRecord | null> {
    const query = `
      SELECT * FROM notification_templates
      WHERE id = $1 AND is_active = TRUE;
    `;

    try {
      const { rows } = await pool.query<NotificationTemplateRecord>(query, [id]);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to get notification template:', error);
      return null;
    }
  },

  /**
   * Get templates by type
   */
  async getByType(type: 'email' | 'in_app'): Promise<NotificationTemplateRecord[]> {
    const query = `
      SELECT * FROM notification_templates
      WHERE type = $1 AND is_active = TRUE
      ORDER BY name;
    `;

    try {
      const { rows } = await pool.query<NotificationTemplateRecord>(query, [type]);
      return rows;
    } catch (error) {
      logger.error('Failed to get notification templates by type:', error);
      return [];
    }
  },

  /**
   * Update a notification template
   */
  async update(id: string, updates: Partial<NotificationTemplateInput>): Promise<NotificationTemplateRecord | null> {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramCount++}`);
      values.push(updates.name);
    }
    if (updates.subject !== undefined) {
      fields.push(`subject = $${paramCount++}`);
      values.push(updates.subject);
    }
    if (updates.html_content !== undefined) {
      fields.push(`html_content = $${paramCount++}`);
      values.push(updates.html_content);
    }
    if (updates.text_content !== undefined) {
      fields.push(`text_content = $${paramCount++}`);
      values.push(updates.text_content);
    }
    if (updates.variables !== undefined) {
      fields.push(`variables = $${paramCount++}`);
      values.push(updates.variables);
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramCount++}`);
      values.push(updates.is_active);
    }

    if (fields.length === 0) {
      return null;
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE notification_templates
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *;
    `;

    try {
      const { rows } = await pool.query<NotificationTemplateRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to update notification template:', error);
      return null;
    }
  },

  /**
   * Delete a notification template (soft delete by setting is_active to false)
   */
  async delete(id: string): Promise<boolean> {
    const query = `
      UPDATE notification_templates
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [id]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to delete notification template:', error);
      return false;
    }
  },

  /**
   * Get all active templates
   */
  async getAll(): Promise<NotificationTemplateRecord[]> {
    const query = `
      SELECT * FROM notification_templates
      WHERE is_active = TRUE
      ORDER BY type, name;
    `;

    try {
      const { rows } = await pool.query<NotificationTemplateRecord>(query);
      return rows;
    } catch (error) {
      logger.error('Failed to get all notification templates:', error);
      return [];
    }
  },
};