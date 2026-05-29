import pool from '../config/database';
import { logger } from '../utils/logger';

export interface PushTokenRecord {
  id: string;
  user_id: string;
  token: string;
  device_type?: string;
  device_id?: string;
  is_active: boolean;
  last_used_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface PushTokenInput {
  user_id: string;
  token: string;
  device_type?: string;
  device_id?: string;
}

/**
 * Push Tokens Model for managing FCM device tokens
 */
export const PushTokensModel = {
  /**
   * Create or update a push token for a user
   */
  async upsert(input: PushTokenInput): Promise<PushTokenRecord | null> {
    const query = `
      INSERT INTO push_tokens (user_id, token, device_type, device_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, token) 
      DO UPDATE SET 
        device_type = COALESCE($3, push_tokens.device_type),
        device_id = COALESCE($4, push_tokens.device_id),
        is_active = TRUE,
        last_used_at = NOW(),
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [input.user_id, input.token, input.device_type || null, input.device_id || null];

    try {
      const { rows } = await pool.query<PushTokenRecord>(query, values);
      return rows[0] || null;
    } catch (error) {
      logger.error('Failed to upsert push token:', error);
      return null;
    }
  },

  /**
   * Get all active tokens for a user
   */
  async getActiveTokensByUserId(userId: string): Promise<PushTokenRecord[]> {
    const query = `
      SELECT * FROM push_tokens
      WHERE user_id = $1 AND is_active = TRUE
      ORDER BY last_used_at DESC;
    `;

    try {
      const { rows } = await pool.query<PushTokenRecord>(query, [userId]);
      return rows;
    } catch (error) {
      logger.error('Failed to get active push tokens:', error);
      return [];
    }
  },

  /**
   * Delete a specific token
   */
  async deleteToken(userId: string, token: string): Promise<boolean> {
    const query = `
      DELETE FROM push_tokens
      WHERE user_id = $1 AND token = $2
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [userId, token]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to delete push token:', error);
      return false;
    }
  },

  /**
   * Mark a token as inactive (for expired/invalid tokens)
   */
  async markTokenInactive(token: string): Promise<boolean> {
    const query = `
      UPDATE push_tokens
      SET is_active = FALSE, updated_at = NOW()
      WHERE token = $1
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [token]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to mark token inactive:', error);
      return false;
    }
  },

  /**
   * Update last_used_at for a token
   */
  async updateLastUsed(token: string): Promise<boolean> {
    const query = `
      UPDATE push_tokens
      SET last_used_at = NOW(), updated_at = NOW()
      WHERE token = $1 AND is_active = TRUE
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [token]);
      return (rowCount ?? 0) > 0;
    } catch (error) {
      logger.error('Failed to update token last_used_at:', error);
      return false;
    }
  },

  /**
   * Delete all tokens for a user
   */
  async deleteAllByUserId(userId: string): Promise<number> {
    const query = `
      DELETE FROM push_tokens
      WHERE user_id = $1
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query, [userId]);
      return rowCount ?? 0;
    } catch (error) {
      logger.error('Failed to delete all push tokens for user:', error);
      return 0;
    }
  },

  /**
   * Clean up inactive tokens older than specified days
   */
  async cleanupInactiveTokens(daysOld: number = 30): Promise<number> {
    const query = `
      DELETE FROM push_tokens
      WHERE is_active = FALSE 
        AND updated_at < NOW() - INTERVAL '${daysOld} days'
      RETURNING id;
    `;

    try {
      const { rowCount } = await pool.query(query);
      return rowCount ?? 0;
    } catch (error) {
      logger.error('Failed to cleanup inactive tokens:', error);
      return 0;
    }
  },
};
