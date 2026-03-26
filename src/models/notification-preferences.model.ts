import pool from '../config/database';
import { logger } from '../utils/logger';

export interface NotificationPreferencesRecord {
  id: string;
  user_id: string;
  email_enabled: boolean;
  in_app_enabled: boolean;
  push_enabled: boolean;
  preferences: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface NotificationPreferencesInput {
  user_id: string;
  email_enabled?: boolean;
  in_app_enabled?: boolean;
  push_enabled?: boolean;
  preferences?: Record<string, any>;
}

/**
 * Notification Preferences Model for managing user notification settings
 */
export const NotificationPreferencesModel = {
  /**
   * Initialize the notification_preferences table
   */
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE,
        email_enabled BOOLEAN DEFAULT TRUE,
        in_app_enabled BOOLEAN DEFAULT TRUE,
        push_enabled BOOLEAN DEFAULT TRUE,
        preferences JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);
    `;
    await pool.query(query);
  },

  /**
   * Create or update notification preferences for a user
   */
  async upsert(input: NotificationPreferencesInput): Promise<NotificationPreferencesRecord | null> {
    const query = `
      INSERT INTO notification_preferences (user_id, email_enabled, in_app_enabled, push_enabled, preferences)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        email_enabled = COALESCE($2, notification_preferences.email_enabled),
        in_app_enabled = COALESCE($3, notification_preferences.in_app_enabled),
        push_enabled = COALESCE($4, notification_preferences.push_enabled),
        preferences = COALESCE($5, notification_preferences.preferences),
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      input.user_id,
      input.email_enabled,
      input.in_app_enabled,
      input.push_enabled,
      JSON.stringify(input.preferences || {}),
    ];

    try {
      const { rows } = await pool.query<NotificationPreferencesRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to upsert notification preferences:', error);
      return null;
    }
  },

  /**
   * Get notification preferences for a user
   */
  async getByUserId(userId: string): Promise<NotificationPreferencesRecord | null> {
    const query = `
      SELECT * FROM notification_preferences
      WHERE user_id = $1;
    `;

    try {
      const { rows } = await pool.query<NotificationPreferencesRecord>(query, [userId]);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to get notification preferences:', error);
      return null;
    }
  },

  /**
   * Get default preferences for a user (if none exist)
   */
  getDefaultPreferences(): Partial<NotificationPreferencesRecord> {
    return {
      email_enabled: true,
      in_app_enabled: true,
      push_enabled: true,
      preferences: {
        booking_confirmed: { email: true, in_app: true, push: true },
        payment_processed: { email: true, in_app: true, push: false },
        session_reminder: { email: true, in_app: true, push: true },
        dispute_created: { email: true, in_app: true, push: true },
        system_alert: { email: true, in_app: true, push: false },
      },
    };
  },

  /**
   * Delete notification preferences for a user
   */
  async deleteByUserId(userId: string): Promise<boolean> {
    const query = `
      DELETE FROM notification_preferences
      WHERE user_id = $1
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [userId]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to delete notification preferences:', error);
      return false;
    }
  },
};