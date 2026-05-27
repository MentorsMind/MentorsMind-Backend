import crypto from "crypto";
import bcrypt from "bcryptjs";
import pool from "../config/database";
import { BulkJobModel, BulkJobRecord } from "../models/bulk-job.model";
import { bulkQueue } from "../queues/bulk.queue";
import { PaymentsService } from "./payments.service";
import { createError } from "../middleware/errorHandler";
import { emailSchema } from "../validators/schemas/common.schemas";
import { z } from "zod";

export interface BulkRowResult {
  index: number;
  success: boolean;
  identifier?: string;
  error?: string;
}

export interface BulkValidationResult<T> {
  valid: boolean;
  records: T[];
  errors: BulkRowResult[];
}

const importUserRowSchema = z.object({
  email: emailSchema,
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  role: z.enum(["mentee", "mentor"]).default("mentee"),
});

const paymentRowSchema = z.object({
  userId: z.string().uuid(),
  bookingId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().min(1).max(12).optional(),
  description: z.string().max(500).optional(),
});

export type BulkImportUserRow = z.infer<typeof importUserRowSchema>;
export type BulkPaymentRow = z.infer<typeof paymentRowSchema>;

export function parseUsersCsv(csvContent: string): {
  header: string[];
  rows: string[][];
} {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw createError(
      "CSV must include a header row and at least one data row",
      400,
    );
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const required = ["email", "firstname", "lastname"];
  for (const col of required) {
    if (!header.includes(col)) {
      throw createError(`CSV missing required column: ${col}`, 400);
    }
  }

  const rows = lines
    .slice(1)
    .map((line) => line.split(",").map((cell) => cell.trim()));
  return { header, rows };
}

export function mapCsvRowsToUsers(
  header: string[],
  rows: string[][],
): BulkImportUserRow[] {
  const indexOf = (name: string) => header.indexOf(name);
  const emailIdx = indexOf("email");
  const firstIdx = indexOf("firstname");
  const lastIdx = indexOf("lastname");
  const roleIdx = indexOf("role");

  return rows.map((cells) => ({
    email: cells[emailIdx] ?? "",
    firstName: cells[firstIdx] ?? "",
    lastName: cells[lastIdx] ?? "",
    role: (cells[roleIdx]?.toLowerCase() === "mentor" ? "mentor" : "mentee") as
      | "mentee"
      | "mentor",
  }));
}

export function validateUserImportRows(
  records: BulkImportUserRow[],
): BulkValidationResult<BulkImportUserRow> {
  const errors: BulkRowResult[] = [];
  const validRecords: BulkImportUserRow[] = [];

  records.forEach((record, index) => {
    const parsed = importUserRowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        index,
        success: false,
        identifier: record.email,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }
    validRecords.push(parsed.data);
  });

  return { valid: errors.length === 0, records: validRecords, errors };
}

export function validatePaymentRows(
  records: BulkPaymentRow[],
): BulkValidationResult<BulkPaymentRow> {
  const errors: BulkRowResult[] = [];
  const validRecords: BulkPaymentRow[] = [];

  records.forEach((record, index) => {
    const parsed = paymentRowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({
        index,
        success: false,
        identifier: record.bookingId,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }
    validRecords.push(parsed.data);
  });

  return { valid: errors.length === 0, records: validRecords, errors };
}

export const BulkService = {
  async requestUserImport(
    requestedBy: string,
    csvContent: string,
  ): Promise<string> {
    const { header, rows } = parseUsersCsv(csvContent);
    const mapped = mapCsvRowsToUsers(header, rows);
    const validation = validateUserImportRows(mapped);

    if (!validation.valid) {
      const err = createError("CSV validation failed", 400);
      (err as any).details = { errors: validation.errors };
      throw err;
    }

    const job = await BulkJobModel.create(
      "users_import",
      requestedBy,
      mapped.length,
    );
    await bulkQueue.add("process-bulk", {
      jobId: job.id,
      jobType: "users_import",
      requestedBy,
      payload: { users: mapped },
    });

    return job.id;
  },

  async requestPaymentsProcess(
    requestedBy: string,
    payments: BulkPaymentRow[],
  ): Promise<string> {
    const validation = validatePaymentRows(payments);
    if (!validation.valid) {
      const err = createError("Payment batch validation failed", 400);
      (err as any).details = { errors: validation.errors };
      throw err;
    }

    const job = await BulkJobModel.create(
      "payments_process",
      requestedBy,
      validation.records.length,
    );
    await bulkQueue.add("process-bulk", {
      jobId: job.id,
      jobType: "payments_process",
      requestedBy,
      payload: { payments: validation.records },
    });

    return job.id;
  },

  async getJob(
    jobId: string,
    requestedBy: string,
  ): Promise<BulkJobRecord | null> {
    const job = await BulkJobModel.findById(jobId);
    if (!job || job.requested_by !== requestedBy) return null;
    return job;
  },

  async processJob(
    jobId: string,
    jobType: "users_import" | "payments_process",
    payload: { users?: BulkImportUserRow[]; payments?: BulkPaymentRow[] },
  ): Promise<void> {
    await BulkJobModel.updateStatus(jobId, "processing");
    const results: BulkRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    try {
      if (jobType === "users_import" && payload.users) {
        for (const [index, user] of payload.users.entries()) {
          try {
            const existing = await pool.query(
              "SELECT id FROM users WHERE email = $1",
              [user.email],
            );
            if (existing.rows.length > 0) {
              throw new Error("Email is already registered");
            }

            const tempPassword = crypto.randomBytes(16).toString("hex");
            const passwordHash = await bcrypt.hash(tempPassword, 10);
            await pool.query(
              `INSERT INTO users (email, password_hash, first_name, last_name, role)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                user.email,
                passwordHash,
                user.firstName,
                user.lastName,
                user.role,
              ],
            );
            successCount++;
            results.push({ index, success: true, identifier: user.email });
          } catch (error) {
            failureCount++;
            results.push({
              index,
              success: false,
              identifier: user.email,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (jobType === "payments_process" && payload.payments) {
        for (const [index, payment] of payload.payments.entries()) {
          try {
            await PaymentsService.initiatePayment({
              userId: payment.userId,
              bookingId: payment.bookingId,
              amount: payment.amount,
              currency: payment.currency,
              description: payment.description,
            });
            successCount++;
            results.push({
              index,
              success: true,
              identifier: payment.bookingId,
            });
          } catch (error) {
            failureCount++;
            results.push({
              index,
              success: false,
              identifier: payment.bookingId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      await BulkJobModel.updateStatus(jobId, "completed", {
        successCount,
        failureCount,
        resultReport: { results },
      });
    } catch (error) {
      await BulkJobModel.updateStatus(jobId, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
        resultReport: { results },
        successCount,
        failureCount,
      });
      throw error;
    }
  },
};
