import { randomUUID } from "crypto";
import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { SocketService } from "./socket.service";

export type ReconciliationReviewStatus =
  | "open"
  | "under_review"
  | "resolved"
  | "ignored";

export interface PaymentReconciliationDiscrepancy {
  id: string;
  booking_id: string;
  user_id: string | null;
  transaction_id: string | null;
  payment_rail: string | null;
  discrepancy_type: string;
  expected_status: string;
  actual_status: string;
  external_reference: string | null;
  review_status: ReconciliationReviewStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentReconciliationSummary {
  runId: string;
  triggeredAt: string;
  totalBookingsChecked: number;
  discrepanciesFound: number;
  discrepanciesCreated: number;
  alertsSent: number;
  durationMs: number;
}

function inferRail(row: any): string | null {
  if (row.payment_rail) return row.payment_rail;
  if (row.stellar_tx_hash) return "stellar";
  if (row.metadata && row.metadata.stripe_charge_id) return "stripe";
  if (row.metadata && row.metadata.payment_rail) return row.metadata.payment_rail;
  if (row.external_reference) {
    return row.external_reference.startsWith("ch_") ? "stripe" : null;
  }
  return null;
}

export const PaymentReconciliationService = {
  async runNightlyReconciliation(): Promise<PaymentReconciliationSummary> {
    const startedAt = Date.now();
    const runId = randomUUID();

    try {
      const bookingsRes = await pool.query(
        `SELECT DISTINCT booking_id, user_id
         FROM transactions
         WHERE type = 'payment'
           AND booking_id IS NOT NULL
           AND status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded')
         ORDER BY booking_id`,
      );

      const bookingIds = bookingsRes.rows
        .map((row) => row.booking_id)
        .filter(Boolean);

      let discrepanciesCreated = 0;
      let alertsSent = 0;

      for (const bookingId of bookingIds) {
        const txRes = await pool.query(
          `SELECT id, booking_id, user_id, status, amount, currency, payment_rail,
                  external_reference, stellar_tx_hash, metadata
           FROM transactions
           WHERE booking_id = $1 AND type = 'payment'
           ORDER BY created_at ASC, id ASC`,
          [bookingId],
        );

        const records = txRes.rows;
        if (records.length <= 1) {
          for (const record of records) {
            const inferredRail = inferRail(record);
            const hasExternalReference = !!record.external_reference || !!(record.metadata && record.metadata.stripe_charge_id);
            if (!inferredRail || !hasExternalReference) {
              const inserted = await this.insertDiscrepancy({
                bookingId,
                userId: record.user_id,
                transactionId: record.id,
                paymentRail: inferredRail,
                discrepancyType: "missing_rail_reference",
                expectedStatus: record.status,
                actualStatus: record.status,
                externalReference: record.external_reference ?? null,
                metadata: {
                  transactionIds: [record.id],
                  paymentRail: inferredRail,
                  missingReference: true,
                },
              });
              if (inserted) discrepanciesCreated++;
            }
          }
          continue;
        }

        const statuses = new Set(records.map((row) => row.status));
        const rails = new Set(records.map((row) => inferRail(row)).filter(Boolean) as string[]);
        const hasCompleted = records.some((row) => row.status === "completed");
        const hasNonCompleted = records.some((row) => row.status !== "completed");

        if (statuses.size > 1 || (hasCompleted && hasNonCompleted) || rails.size > 1) {
          const primaryTx = records.find((row) => row.status === "completed") ?? records[0];
          const inserted = await this.insertDiscrepancy({
            bookingId,
            userId: primaryTx?.user_id ?? null,
            transactionId: primaryTx?.id ?? null,
            paymentRail: inferRail(primaryTx),
            discrepancyType: "status_mismatch",
            expectedStatus: "completed",
            actualStatus: Array.from(statuses).join(","),
            externalReference: primaryTx?.external_reference ?? null,
            metadata: {
              transactionIds: records.map((row) => row.id),
              statuses: records.map((row) => row.status),
              rails: records.map((row) => inferRail(row)),
            },
          });
          if (inserted) discrepanciesCreated++;
        }

        for (const record of records) {
          const inferredRail = inferRail(record);
          const hasExternalReference = !!record.external_reference || !!(record.metadata && record.metadata.stripe_charge_id);
          if (!inferredRail || !hasExternalReference) {
            const inserted = await this.insertDiscrepancy({
              bookingId,
              userId: record.user_id,
              transactionId: record.id,
              paymentRail: inferredRail,
              discrepancyType: "missing_rail_reference",
              expectedStatus: record.status,
              actualStatus: record.status,
              externalReference: record.external_reference ?? null,
              metadata: {
                transactionIds: [record.id],
                paymentRail: inferredRail,
                missingReference: true,
              },
            });
            if (inserted) discrepanciesCreated++;
          }
        }
      }

      if (discrepanciesCreated > 0) {
        const { rows } = await pool.query(
          `SELECT id, booking_id, payment_rail, discrepancy_type, review_status
           FROM payment_reconciliation_discrepancy
           WHERE review_status = 'open'
           ORDER BY created_at DESC
           LIMIT 25`,
        );
        SocketService.emitToRoom("admin", "payment:reconciliation:alert", {
          runId,
          triggeredAt: new Date().toISOString(),
          count: rows.length,
          discrepancies: rows,
        });
        alertsSent = rows.length;
      }

      return {
        runId,
        triggeredAt: new Date().toISOString(),
        totalBookingsChecked: bookingIds.length,
        discrepanciesFound: discrepanciesCreated,
        discrepanciesCreated,
        alertsSent,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("PaymentReconciliationService.runNightlyReconciliation failed", {
        error: message,
        runId,
      });
      throw error;
    }
  },

  async insertDiscrepancy(input: {
    bookingId: string;
    userId: string | null;
    transactionId: string | null;
    paymentRail: string | null;
    discrepancyType: string;
    expectedStatus: string;
    actualStatus: string;
    externalReference: string | null;
    metadata: Record<string, unknown>;
  }): Promise<boolean> {
    const existing = await pool.query(
      `SELECT id FROM payment_reconciliation_discrepancy
       WHERE booking_id = $1 AND discrepancy_type = $2 AND review_status IN ('open', 'under_review')
       LIMIT 1`,
      [input.bookingId, input.discrepancyType],
    );

    if (existing.rows[0]) {
      return false;
    }

    await pool.query(
      `INSERT INTO payment_reconciliation_discrepancy
         (booking_id, user_id, transaction_id, payment_rail, discrepancy_type,
          expected_status, actual_status, external_reference, metadata, review_status,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'open', NOW(), NOW())`,
      [
        input.bookingId,
        input.userId,
        input.transactionId,
        input.paymentRail,
        input.discrepancyType,
        input.expectedStatus,
        input.actualStatus,
        input.externalReference,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    logger.warn("Payment reconciliation discrepancy detected", {
      bookingId: input.bookingId,
      discrepancyType: input.discrepancyType,
      paymentRail: input.paymentRail,
      actualStatus: input.actualStatus,
    });

    return true;
  },

  async listDiscrepancies(options: { limit?: number; offset?: number; status?: ReconciliationReviewStatus; }): Promise<{ rows: PaymentReconciliationDiscrepancy[]; total: number }> {
    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;
    const params: unknown[] = [];
    let whereClause = "";

    if (options.status) {
      params.push(options.status);
      whereClause = `WHERE review_status = $${params.length}`;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM payment_reconciliation_discrepancy ${whereClause}`,
      params,
    );

    params.push(limit, offset);
    const rowsRes = await pool.query<PaymentReconciliationDiscrepancy>(
      `SELECT * FROM payment_reconciliation_discrepancy ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      rows: rowsRes.rows,
      total: Number(countRes.rows[0]?.total ?? 0),
    };
  },

  async reviewDiscrepancy(
    discrepancyId: string,
    reviewedBy: string,
    status: ReconciliationReviewStatus,
    notes?: string,
  ): Promise<PaymentReconciliationDiscrepancy> {
    const { rows } = await pool.query<PaymentReconciliationDiscrepancy>(
      `UPDATE payment_reconciliation_discrepancy
       SET review_status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           notes = COALESCE($3, notes),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, reviewedBy, notes ?? null, discrepancyId],
    );

    if (!rows[0]) {
      throw new Error("Payment reconciliation discrepancy not found");
    }

    return rows[0];
  },
};
