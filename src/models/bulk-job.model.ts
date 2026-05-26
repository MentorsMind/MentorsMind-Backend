import pool from "../config/database";

export type BulkJobType = "users_import" | "payments_process";
export type BulkJobStatus = "pending" | "processing" | "completed" | "failed";

export interface BulkJobRecord {
  id: string;
  job_type: BulkJobType;
  requested_by: string;
  status: BulkJobStatus;
  total_records: number;
  success_count: number;
  failure_count: number;
  result_report: Record<string, unknown>;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export const BulkJobModel = {
  async create(
    jobType: BulkJobType,
    requestedBy: string,
    totalRecords: number,
  ): Promise<BulkJobRecord> {
    const { rows } = await pool.query<BulkJobRecord>(
      `INSERT INTO bulk_jobs (job_type, requested_by, status, total_records)
       VALUES ($1, $2, 'pending', $3)
       RETURNING *`,
      [jobType, requestedBy, totalRecords],
    );
    return rows[0];
  },

  async findById(id: string): Promise<BulkJobRecord | null> {
    const { rows } = await pool.query<BulkJobRecord>(
      "SELECT * FROM bulk_jobs WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  },

  async updateStatus(
    id: string,
    status: BulkJobStatus,
    patch?: {
      successCount?: number;
      failureCount?: number;
      resultReport?: Record<string, unknown>;
      errorMessage?: string;
    },
  ): Promise<void> {
    await pool.query(
      `UPDATE bulk_jobs
       SET status = $2,
           success_count = COALESCE($3, success_count),
           failure_count = COALESCE($4, failure_count),
           result_report = COALESCE($5, result_report),
           error_message = COALESCE($6, error_message),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        id,
        status,
        patch?.successCount ?? null,
        patch?.failureCount ?? null,
        patch?.resultReport ? JSON.stringify(patch.resultReport) : null,
        patch?.errorMessage ?? null,
      ],
    );
  },
};
