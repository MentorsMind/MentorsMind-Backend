import crypto from "crypto";
import bcrypt from "bcryptjs";
import pool from "../config/database";
import { BulkJobModel, BulkJobRecord } from "../models/bulk-job.model";
import { bulkQueue } from "../queues/bulk.queue";
import { PaymentsService } from "./payments.service";
import { createError } from "../middleware/errorHandler";
import { emailSchema } from "../validators/schemas/common.schemas";
import { z } from "zod";
import { QUEUE_PRIORITIES } from "../config/queue";
import { redis } from "../config/redis";
import { SocketService } from "./socket.service";
import { logger } from "../utils/logger.utils";

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

// ---------------------------------------------------------------------------
// Mentor import schema
// ---------------------------------------------------------------------------
const importMentorRowSchema = z.object({
  email: emailSchema,
  firstName: z.string().min(2).max(50),
  lastName: z.string().min(2).max(50),
  bio: z.string().min(10).max(2000).optional(),
  expertise: z.string().min(2).max(500).optional(), // comma-separated tags
  hourlyRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  currency: z.string().min(2).max(10).optional().default("USD"),
  timezone: z.string().optional(),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
  yearsExperience: z.string().regex(/^\d+$/).optional(),
});
export type BulkImportMentorRow = z.infer<typeof importMentorRowSchema>;

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

// ---------------------------------------------------------------------------
// Mentor CSV helpers
// ---------------------------------------------------------------------------

export function parseMentorsCsv(csvContent: string): {
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

export function mapCsvRowsToMentors(
  header: string[],
  rows: string[][],
): BulkImportMentorRow[] {
  const indexOf = (name: string) => header.indexOf(name);
  const emailIdx = indexOf("email");
  const firstIdx = indexOf("firstname");
  const lastIdx = indexOf("lastname");
  const bioIdx = indexOf("bio");
  const expertiseIdx = indexOf("expertise");
  const hourlyRateIdx = indexOf("hourlyrate");
  const currencyIdx = indexOf("currency");
  const timezoneIdx = indexOf("timezone");
  const linkedinUrlIdx = indexOf("linkedinurl");
  const yearsExperienceIdx = indexOf("yearsexperience");

  return rows.map((cells) => ({
    email: cells[emailIdx] ?? "",
    firstName: cells[firstIdx] ?? "",
    lastName: cells[lastIdx] ?? "",
    ...(bioIdx !== -1 && cells[bioIdx] ? { bio: cells[bioIdx] } : {}),
    ...(expertiseIdx !== -1 && cells[expertiseIdx]
      ? { expertise: cells[expertiseIdx] }
      : {}),
    ...(hourlyRateIdx !== -1 && cells[hourlyRateIdx]
      ? { hourlyRate: cells[hourlyRateIdx] }
      : {}),
    ...(currencyIdx !== -1 && cells[currencyIdx]
      ? { currency: cells[currencyIdx] }
      : {}),
    ...(timezoneIdx !== -1 && cells[timezoneIdx]
      ? { timezone: cells[timezoneIdx] }
      : {}),
    ...(linkedinUrlIdx !== -1 && cells[linkedinUrlIdx] !== undefined
      ? { linkedinUrl: cells[linkedinUrlIdx] }
      : {}),
    ...(yearsExperienceIdx !== -1 && cells[yearsExperienceIdx]
      ? { yearsExperience: cells[yearsExperienceIdx] }
      : {}),
  })) as BulkImportMentorRow[];
}

export function validateMentorImportRows(
  records: BulkImportMentorRow[],
): BulkValidationResult<BulkImportMentorRow> {
  const errors: BulkRowResult[] = [];
  const validRecords: BulkImportMentorRow[] = [];

  records.forEach((record, index) => {
    const parsed = importMentorRowSchema.safeParse(record);
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
    }, { priority: QUEUE_PRIORITIES.BULK });

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
    }, { priority: QUEUE_PRIORITIES.BULK });

    return job.id;
  },

  async requestMentorImport(
    requestedBy: string,
    csvContent: string,
  ): Promise<string> {
    const { header, rows } = parseMentorsCsv(csvContent);
    const mapped = mapCsvRowsToMentors(header, rows);
    const validation = validateMentorImportRows(mapped);

    if (!validation.valid) {
      const err = createError("Mentor CSV validation failed", 400);
      (err as any).details = { errors: validation.errors };
      throw err;
    }

    const job = await BulkJobModel.create(
      "mentors_import" as any,
      requestedBy,
      mapped.length,
    );
    await bulkQueue.add("process-bulk", {
      jobId: job.id,
      jobType: "mentors_import",
      requestedBy,
      payload: { mentors: mapped },
    }, { priority: QUEUE_PRIORITIES.BULK });

    logger.info("[BulkService] Mentor import job queued", {
      jobId: job.id,
      totalRecords: mapped.length,
      requestedBy,
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
    jobType: "users_import" | "payments_process" | "mentors_import",
    payload: { users?: BulkImportUserRow[]; payments?: BulkPaymentRow[]; mentors?: BulkImportMentorRow[] },
    requestedBy?: string
  ): Promise<void> {
    await BulkJobModel.updateStatus(jobId, "processing");
    if (!requestedBy) {
      const job = await BulkJobModel.findById(jobId);
      requestedBy = job?.requested_by;
    }
    const results: BulkRowResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    const totalItems = (
      jobType === "users_import" ? payload.users?.length :
      jobType === "payments_process" ? payload.payments?.length :
      payload.mentors?.length
    ) || 0;

    const trackProgress = async (currentIdx: number) => {
      if (totalItems === 0) return;
      const processed = currentIdx + 1;
      const progress = Math.floor((processed / totalItems) * 100);
      const prevProgress = Math.floor((currentIdx / totalItems) * 100);
      
      if (progress > prevProgress || processed === 1) {
        const state = { total: totalItems, processed, failed: failureCount, status: "processing" };
        await redis.set(`bulk:${jobId}:progress`, JSON.stringify(state), "EX", 3600);
      }
      if (progress % 5 === 0 && (progress > prevProgress || processed === 1)) {
        const eventData = { jobId, progress, processed, total: totalItems, failed: failureCount, status: "processing" };
        if (requestedBy) {
          SocketService.emitToUser(requestedBy, "bulk:progress", eventData);
        } else {
          SocketService.emitToAll("bulk:progress", eventData);
        }
      }
    };

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
          await trackProgress(index);
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
          await trackProgress(index);
        }
      }

      if (jobType === "mentors_import" && payload.mentors) {
        for (const [index, mentor] of payload.mentors.entries()) {
          try {
            // Check for existing account
            const existing = await pool.query(
              "SELECT id FROM users WHERE email = $1",
              [mentor.email],
            );
            if (existing.rows.length > 0) {
              throw new Error("Email is already registered");
            }

            // Generate a temporary password — mentor will reset via onboarding email
            const tempPassword = crypto.randomBytes(16).toString("hex");
            const passwordHash = await bcrypt.hash(tempPassword, 10);

            // Parse comma-separated expertise into a PostgreSQL text array
            const expertiseArray = mentor.expertise
              ? mentor.expertise.split(",").map((e) => e.trim()).filter(Boolean)
              : null;

            await pool.query(
              `INSERT INTO users (
                 email, password_hash, first_name, last_name, role,
                 bio, expertise, hourly_rate, timezone, years_of_experience,
                 status, metadata
               ) VALUES ($1, $2, $3, $4, 'mentor', $5, $6, $7, $8, $9,
                 'pending_verification', $10)`,
              [
                mentor.email,
                passwordHash,
                mentor.firstName,
                mentor.lastName,
                mentor.bio ?? null,
                expertiseArray,
                mentor.hourlyRate ? parseFloat(mentor.hourlyRate) : null,
                mentor.timezone ?? null,
                mentor.yearsExperience ? parseInt(mentor.yearsExperience, 10) : null,
                JSON.stringify({
                  bulkImported: true,
                  importedAt: new Date().toISOString(),
                  ...(mentor.linkedinUrl ? { linkedinUrl: mentor.linkedinUrl } : {}),
                  ...(mentor.currency ? { currency: mentor.currency } : {}),
                }),
              ],
            );

            successCount++;
            results.push({ index, success: true, identifier: mentor.email });
            logger.debug("[BulkService] Mentor account created", { email: mentor.email });
          } catch (error) {
            failureCount++;
            results.push({
              index,
              success: false,
              identifier: mentor.email,
              error: error instanceof Error ? error.message : String(error),
            });
            logger.warn("[BulkService] Failed to create mentor account", {
              email: mentor.email,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          await trackProgress(index);
        }
      }

      const state = { total: totalItems, processed: successCount + failureCount, failed: failureCount, status: "completed" };
      await redis.set(`bulk:${jobId}:progress`, JSON.stringify(state), "EX", 3600);
      const eventData = { jobId, progress: 100, status: "completed" };
      if (requestedBy) {
        SocketService.emitToUser(requestedBy, "bulk:progress", eventData);
      } else {
        SocketService.emitToAll("bulk:progress", eventData);
      }
      await BulkJobModel.updateStatus(jobId, "completed", {
        successCount,
        failureCount,
        resultReport: { results },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const state = { total: totalItems, processed: successCount + failureCount, failed: failureCount, status: "failed", error: errorMessage };
      await redis.set(`bulk:${jobId}:progress`, JSON.stringify(state), "EX", 3600);
      const eventData = { jobId, status: "failed", error: errorMessage };
      if (requestedBy) {
        SocketService.emitToUser(requestedBy, "bulk:progress", eventData);
      } else {
        SocketService.emitToAll("bulk:progress", eventData);
      }

      await BulkJobModel.updateStatus(jobId, "failed", {
        errorMessage,
        resultReport: { results },
        successCount,
        failureCount,
      });
      throw error;
    }
  },
};
