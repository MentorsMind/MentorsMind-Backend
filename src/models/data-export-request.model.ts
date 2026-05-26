import pool from "../config/database";

export type DataExportStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export interface DataExportRequest {
  id: string;
  user_id: string;
  status: DataExportStatus;
  file_path: string | null;
  file_size: string | null;
  checksum: string | null;
  error_message: string | null;
  requested_at: Date;
  processed_at: Date | null;
  expires_at: Date | null;
  download_count: number;
  created_at: Date;
  updated_at: Date;
}

export const DataExportRequestModel = {
  async create(userId: string): Promise<DataExportRequest> {
    const query = `
            INSERT INTO data_export_requests (user_id)
            VALUES ($1)
            RETURNING *;
        `;
    const { rows } = await pool.query<DataExportRequest>(query, [userId]);
    return rows[0];
  },

  async findLatestByUserId(userId: string): Promise<DataExportRequest | null> {
    const query = `
            SELECT * FROM data_export_requests
            WHERE user_id = $1
            ORDER BY requested_at DESC
            LIMIT 1;
        `;
    const { rows } = await pool.query<DataExportRequest>(query, [userId]);
    return rows[0] || null;
  },

  async findById(id: string): Promise<DataExportRequest | null> {
    const query = "SELECT * FROM data_export_requests WHERE id = $1;";
    const { rows } = await pool.query<DataExportRequest>(query, [id]);
    return rows[0] || null;
  },

  async updateStatus(
    id: string,
    status: DataExportStatus,
    data: Partial<{
      filePath: string;
      fileSize: number;
      checksum: string;
      errorMessage: string;
      processedAt: Date;
      expiresAt: Date;
    }> = {},
  ): Promise<void> {
    const query = `
            UPDATE data_export_requests
            SET status = $2,
                file_path = COALESCE($3, file_path),
                file_size = COALESCE($4, file_size),
                checksum = COALESCE($5, checksum),
                error_message = COALESCE($6, error_message),
                processed_at = COALESCE($7, processed_at),
                expires_at = COALESCE($8, expires_at),
                updated_at = NOW()
            WHERE id = $1;
        `;
    await pool.query(query, [
      id,
      status,
      data.filePath || null,
      data.fileSize || null,
      data.checksum || null,
      data.errorMessage || null,
      data.processedAt || null,
      data.expiresAt || null,
    ]);
  },

  async incrementDownloadCount(id: string): Promise<void> {
    const query = `
            UPDATE data_export_requests
            SET download_count = download_count + 1,
                updated_at = NOW()
            WHERE id = $1;
        `;
    await pool.query(query, [id]);
  },
};
