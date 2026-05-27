import { Response } from "express";
import { AuthenticatedRequest } from "../types/api.types";
import { ResponseUtil } from "../utils/response.utils";
import { BulkService } from "../services/bulk.service";

function getUserId(req: AuthenticatedRequest): string {
  return (req.user as any)?.id ?? (req.user as any)?.userId;
}

export const BulkController = {
  async importUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file?.buffer) {
      ResponseUtil.error(res, "CSV file is required", 400);
      return;
    }

    const csvContent = file.buffer.toString("utf-8");
    const jobId = await BulkService.requestUserImport(
      getUserId(req),
      csvContent,
    );
    ResponseUtil.success(res, { jobId }, "Bulk user import queued", 202);
  },

  async processPayments(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<void> {
    const payments = req.body?.payments;
    if (!Array.isArray(payments) || payments.length === 0) {
      ResponseUtil.error(res, "payments array is required", 400);
      return;
    }

    const jobId = await BulkService.requestPaymentsProcess(
      getUserId(req),
      payments,
    );
    ResponseUtil.success(res, { jobId }, "Bulk payment processing queued", 202);
  },

  async getJobStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const job = await BulkService.getJob(
      req.params.jobId as string,
      getUserId(req),
    );
    if (!job) {
      ResponseUtil.notFound(res, "Bulk job not found");
      return;
    }

    ResponseUtil.success(res, {
      id: job.id,
      job_type: job.job_type,
      status: job.status,
      total_records: job.total_records,
      success_count: job.success_count,
      failure_count: job.failure_count,
      result_report: job.result_report,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  },
};
