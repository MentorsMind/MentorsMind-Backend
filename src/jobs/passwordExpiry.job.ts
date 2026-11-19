/**
 * passwordExpiry.job.ts
 *
 * Enforces the PASSWORD_EXPIRY_DAYS policy defined in env.ts.
 *
 * Two enforcement layers work in tandem:
 *
 * 1. Background job (this file) — daily sweep that marks accounts as
 *    `password_expired` when their password_changed_at is older than the
 *    configured threshold.  Also sends reminder notifications at 7 and 1 day
 *    before expiry.
 *
 * 2. Login check — see AuthService.checkPasswordExpiry() which is called from
 *    auth.service.ts on every successful login and throws
 *    AUTH_PASSWORD_EXPIRED when the account has the expired flag set.
 */

import { CronJob } from "cron";
import pool from "../config/database";
import { env } from "../config/env";
import { logger } from "../utils/logger.utils";
import { NotificationService } from "../services/notification.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPIRY_DAYS = Number(env.PASSWORD_EXPIRY_DAYS);

interface ExpiredUserRow {
  id: string;
  email: string;
}

interface ExpiringUserRow {
  id: string;
  email: string;
  days_until_expiry: number;
}

async function markExpiredPasswords(): Promise<number> {
  const result = await pool.query<ExpiredUserRow>(
    `UPDATE users
        SET password_expired = TRUE
      WHERE password_expired IS DISTINCT FROM TRUE
        AND deleted_at IS NULL
        AND status = 'active'
        AND password_changed_at < NOW() - ($1 || ' days')::INTERVAL
      RETURNING id, email`,
    [String(EXPIRY_DAYS)],
  );
  return result.rowCount ?? 0;
}

async function sendExpiryReminders(daysAhead: number): Promise<void> {
  const { rows } = await pool.query<ExpiringUserRow>(
    `SELECT id,
            email,
            EXTRACT(DAY FROM (
              password_changed_at + ($1 || ' days')::INTERVAL - NOW()
            ))::int AS days_until_expiry
       FROM users
      WHERE password_expired IS NOT TRUE
        AND deleted_at IS NULL
        AND status = 'active'
        AND password_changed_at BETWEEN
              NOW() - ($1 || ' days')::INTERVAL - INTERVAL '1 day'
          AND NOW() - ($1 || ' days')::INTERVAL + INTERVAL '${daysAhead} days'`,
    [String(EXPIRY_DAYS)],
  );

  for (const user of rows) {
    try {
      await NotificationService.createNotification({
        userId: user.id,
        type: "system_alert",
        title: "Password expiry reminder",
        message: `Your password will expire in ${user.days_until_expiry} day(s). Please update it to maintain access.`,
        data: { daysUntilExpiry: user.days_until_expiry },
      });
    } catch (err) {
      logger.warn("Failed to send password expiry reminder", {
        userId: user.id,
        err,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Job class
// ---------------------------------------------------------------------------

class PasswordExpiryJob {
  private job: CronJob | null = null;

  initialize(): void {
    if (EXPIRY_DAYS <= 0) {
      logger.info("Password expiry disabled (PASSWORD_EXPIRY_DAYS <= 0)");
      return;
    }

    this.job = new CronJob(
      "0 1 * * *",   // 01:00 UTC daily
      async () => {
        logger.info("Running password expiry sweep");
        await this.runSweep();
      },
      null,
      false,
      "UTC",
    );

    this.job.start();
    logger.info("Password expiry job started (daily at 01:00 UTC)", {
      expiryDays: EXPIRY_DAYS,
    });
  }

  async runSweep(): Promise<void> {
    try {
      const expired = await markExpiredPasswords();
      if (expired > 0) {
        logger.info("Marked passwords as expired", { count: expired });
      }

      // Send reminders at 7 and 1 day before expiry
      await sendExpiryReminders(7);
      await sendExpiryReminders(1);
    } catch (err) {
      logger.error("Password expiry sweep failed", { err });
    }
  }

  stop(): void {
    this.job?.stop();
  }
}

export const passwordExpiryJob = new PasswordExpiryJob();
