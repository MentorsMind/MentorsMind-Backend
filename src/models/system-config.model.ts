import pool from '../config/database';

export interface SystemConfigRecord {
  key: string;
  value: any;
  updated_at: Date;
}

export const SystemConfigModel = {
  async getValue<T>(key: string): Promise<T | null> {
    const { rows } = await pool.query<SystemConfigRecord>(
      'SELECT value FROM system_configs WHERE key = $1',
      [key]
    );
    return rows[0]?.value || null;
  },

  async setValue(key: string, value: any): Promise<void> {
    await pool.query(
      `INSERT INTO system_configs (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  }
};
