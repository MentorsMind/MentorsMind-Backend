import pool from "../config/database";

export interface ExportJob {
  id: string;
  user_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  storage_key: string | null;
  error_message: string | null;
  expires_at: Date | null;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export const ExportJobModel = {
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS export_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        storage_key TEXT,
        error_message TEXT,
        expires_at TIMESTAMP WITH TIME ZONE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_export_jobs_user_id ON export_jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
    `;
    await pool.query(query);
  },

  async create(
    userId: string,
    metadata?: Record<string, any>,
  ): Promise<ExportJob> {
    const query = `
      INSERT INTO export_jobs (user_id, status, metadata)
      VALUES ($1, 'pending', $2)
      RETURNING *;
    `;
    const { rows } = await pool.query<ExportJob>(query, [
      userId,
      JSON.stringify(metadata || {}),
    ]);
    return rows[0];
  },

  async findById(id: string): Promise<ExportJob | null> {
    const query = "SELECT * FROM export_jobs WHERE id = $1;";
    const { rows } = await pool.query<ExportJob>(query, [id]);
    return rows[0] || null;
  },

  async getStatus(id: string): Promise<ExportJob | null> {
    const query = "SELECT * FROM export_jobs WHERE id = $1;";
    const { rows } = await pool.query<ExportJob>(query, [id]);
    return rows[0] || null;
  },

  async updateStatus(
    id: string,
    status: ExportJob["status"],
    storageKey?: string,
    errorMessage?: string,
    expiresAt?: Date,
  ): Promise<void> {
    const query = `
      UPDATE export_jobs
      SET status = $2,
          storage_key = COALESCE($3, storage_key),
          error_message = COALESCE($4, error_message),
          expires_at = COALESCE($5, expires_at),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1;
    `;
    await pool.query(query, [id, status, storageKey, errorMessage, expiresAt]);
  },
};
