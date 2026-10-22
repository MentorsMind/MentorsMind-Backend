import pool from "../config/database";
import { redis } from "../config/redis";
import { EncryptionUtil } from "../utils/encryption.utils";
import { logger } from "../utils/logger.utils";
import { JwksService } from "../services/jwks.service";
import * as Sentry from "@sentry/node";
// HSM-backed key management (integrated — does not break existing PII rotation)
import keyManagementService from "../services/key-management.service";

const ROTATION_BATCH_SIZE = 100;

interface EncryptedUserRow {
  id: string;
  phone_number_encrypted: string | null;
  date_of_birth_encrypted: string | null;
  government_id_number_encrypted: string | null;
  bank_account_details_encrypted: string | null;
  pii_encryption_version: string | null;
}

interface EncryptedWebhookRow {
  id: string;
  api_key_encrypted: string | null;
  secret_encrypted: string | null;
  api_key_encryption_version: string | null;
}

interface EncryptedOAuthRow {
  id: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_encryption_version: string | null;
}

declare const require: any;

class KeyRotationJob {
  private jobs: Map<string, any> = new Map();

  initialize(): void {
    this.startPiiRotation();
    this.startHsmRotation();
    logger.info("Key rotation jobs initialized", { jobCount: this.jobs.size });
  }

  /** JWT key rotation execution */
  async runJwtRotation(): Promise<void> {
    logger.info("Running scheduled JWT key rotation");
    
    const now = new Date();
    const monthYear = `${now.getUTCMonth() + 1}-${now.getUTCFullYear()}`;
    const lockKey = `jwks:rotation:lock:${monthYear}`;
    const replicaId = process.env.RAILWAY_REPLICA_ID || "local-instance";

    try {
      // Attempt to acquire lock (SET NX EX 3600)
      const acquired = await (redis as any).set(lockKey, replicaId, "NX", "EX", 3600);
      if (!acquired) {
        logger.info("JWT key rotation skipped: lock acquired by another instance");
        return;
      }

      logger.info("JWT key rotation lock acquired", { lockKey, replicaId });

      // Implement lock heartbeat: the owning instance refreshes the lock TTL every 10 minutes during rotation
      const heartbeatInterval = setInterval(async () => {
        try {
          await redis.expire(lockKey, 3600);
        } catch (err) {
          logger.warn("Failed to refresh JWT rotation lock heartbeat", { error: err });
        }
      }, 10 * 60 * 1000);

      try {
        await JwksService.rotateKeys(true);
      } finally {
        clearInterval(heartbeatInterval);
      }
    } catch (error) {
      const err = error as Error;
      logger.error("JWT key rotation failed", { error: err.message, stack: err.stack });
      Sentry.captureException(err);
    }
  }

  /** PII/encryption key rotation — runs weekly at 1 AM UTC */
  private startPiiRotation(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 1 * * 0", async () => {
        logger.info("Running scheduled PII encryption key rotation");
        try {
          await this.runPiiRotation();
        } catch (error) {
          const err = error as Error;
          logger.error("PII key rotation failed", { error: err.message, stack: err.stack });
          Sentry.captureException(err);
        }
      });

      job.start();
      this.jobs.set("pii-rotation", job);
      logger.info("PII key rotation job started (weekly at 1 AM UTC)");
    } catch (error) {
      logger.warn("Failed to start PII key rotation job", {
        error: (error as Error).message,
      });
    }
  }

  async runPiiRotation(): Promise<{ 
    piiScanned: number; 
    piiRotated: number; 
    webhookScanned: number; 
    webhookRotated: number; 
    oauthScanned: number; 
    oauthRotated: number; 
    targetVersion: string 
  }> {
    const targetVersion = await EncryptionUtil.getCurrentKeyVersion();
    
    // Rotate PII fields in users table
    const piiResult = await this.rotateUserPII(targetVersion);
    
    // Rotate webhook API keys and secrets
    const webhookResult = await this.rotateWebhookKeys(targetVersion);
    
    // Rotate OAuth tokens
    const oauthResult = await this.rotateOAuthTokens(targetVersion);

    logger.info("Encryption rotation completed", {
      pii: piiResult,
      webhooks: webhookResult,
      oauth: oauthResult,
      targetVersion,
    });

    return {
      piiScanned: piiResult.scanned,
      piiRotated: piiResult.rotated,
      webhookScanned: webhookResult.scanned,
      webhookRotated: webhookResult.rotated,
      oauthScanned: oauthResult.scanned,
      oauthRotated: oauthResult.rotated,
      targetVersion,
    };
  }

  async rotateUserPII(targetVersion: string): Promise<{ scanned: number; rotated: number }> {
    let rotated = 0;
    let scanned = 0;
    let hasMore = true;

    while (hasMore) {
      const { rows } = await pool.query<EncryptedUserRow>(
        `SELECT id, phone_number_encrypted, date_of_birth_encrypted,
                government_id_number_encrypted, bank_account_details_encrypted,
                pii_encryption_version
           FROM users
          WHERE (
                  phone_number_encrypted IS NOT NULL
               OR date_of_birth_encrypted IS NOT NULL
               OR government_id_number_encrypted IS NOT NULL
               OR bank_account_details_encrypted IS NOT NULL
                )
            AND COALESCE(pii_encryption_version, '') != $1
          ORDER BY updated_at ASC NULLS LAST, id ASC
          LIMIT $2`,
        [targetVersion, ROTATION_BATCH_SIZE],
      );

      hasMore = rows.length === ROTATION_BATCH_SIZE;
      scanned += rows.length;

      for (const row of rows) {
        await pool.query(
          `UPDATE users
              SET phone_number_encrypted = $2,
                  date_of_birth_encrypted = $3,
                  government_id_number_encrypted = $4,
                  bank_account_details_encrypted = $5,
                  pii_encryption_version = $6,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            row.id,
            await EncryptionUtil.rotateEncryptedValue(row.phone_number_encrypted),
            await EncryptionUtil.rotateEncryptedValue(row.date_of_birth_encrypted),
            await EncryptionUtil.rotateEncryptedValue(
              row.government_id_number_encrypted,
            ),
            await EncryptionUtil.rotateEncryptedValue(
              row.bank_account_details_encrypted,
            ),
            targetVersion,
          ],
        );
        rotated += 1;
      }
    }

    return { scanned, rotated };
  }

  async rotateWebhookKeys(targetVersion: string): Promise<{ scanned: number; rotated: number }> {
    let rotated = 0;
    let scanned = 0;
    let hasMore = true;

    while (hasMore) {
      const { rows } = await pool.query<EncryptedWebhookRow>(
        `SELECT id, api_key_encrypted, secret_encrypted, api_key_encryption_version
           FROM webhooks
          WHERE (api_key_encrypted IS NOT NULL OR secret_encrypted IS NOT NULL)
            AND COALESCE(api_key_encryption_version, '') != $1
          ORDER BY updated_at ASC NULLS LAST, id ASC
          LIMIT $2`,
        [targetVersion, ROTATION_BATCH_SIZE],
      );

      hasMore = rows.length === ROTATION_BATCH_SIZE;
      scanned += rows.length;

      for (const row of rows) {
        await pool.query(
          `UPDATE webhooks
              SET api_key_encrypted = $2,
                  secret_encrypted = $3,
                  api_key_encryption_version = $4,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            row.id,
            await EncryptionUtil.rotateEncryptedValue(row.api_key_encrypted),
            await EncryptionUtil.rotateEncryptedValue(row.secret_encrypted),
            targetVersion,
          ],
        );
        rotated += 1;
      }
    }

    return { scanned, rotated };
  }

  async rotateOAuthTokens(targetVersion: string): Promise<{ scanned: number; rotated: number }> {
    let rotated = 0;
    let scanned = 0;
    let hasMore = true;

    while (hasMore) {
      const { rows } = await pool.query<EncryptedOAuthRow>(
        `SELECT id, access_token_encrypted, refresh_token_encrypted, token_encryption_version
           FROM oauth_accounts
          WHERE (access_token_encrypted IS NOT NULL OR refresh_token_encrypted IS NOT NULL)
            AND COALESCE(token_encryption_version, '') != $1
          ORDER BY updated_at ASC NULLS LAST, id ASC
          LIMIT $2`,
        [targetVersion, ROTATION_BATCH_SIZE],
      );

      hasMore = rows.length === ROTATION_BATCH_SIZE;
      scanned += rows.length;

      for (const row of rows) {
        await pool.query(
          `UPDATE oauth_accounts
              SET access_token_encrypted = $2,
                  refresh_token_encrypted = $3,
                  token_encryption_version = $4,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            row.id,
            await EncryptionUtil.rotateEncryptedValue(row.access_token_encrypted),
            await EncryptionUtil.rotateEncryptedValue(row.refresh_token_encrypted),
            targetVersion,
          ],
        );
        rotated += 1;
      }
    }

    return { scanned, rotated };
  }

  /** HSM key rotation — runs daily at 2 AM UTC (complements PII rotation) */
  private startHsmRotation(): void {
    try {
      const { CronJob } = require("cron");
      const job = new CronJob("0 2 * * *", async () => {
        logger.info("Running scheduled HSM key rotation sweep");
        try {
          const summaries = await keyManagementService.runScheduledRotation();
          logger.info(
            { rotatedPurposes: summaries.length },
            "HSM scheduled rotation sweep complete",
          );
        } catch (error) {
          const err = error as Error;
          logger.error("HSM key rotation failed", { error: err.message, stack: err.stack });
          Sentry.captureException(err);
        }
      });

      job.start();
      this.jobs.set("hsm-rotation", job);
      logger.info("HSM key rotation job started (daily at 2 AM UTC)");
    } catch (error) {
      logger.warn("Failed to start HSM key rotation job", {
        error: (error as Error).message,
      });
    }
  }

  getStatus(): Record<string, { running: boolean }> {
    const status: Record<string, { running: boolean }> = {};
    for (const [name, job] of this.jobs.entries()) {
      status[name] = { running: job.running ?? false };
    }
    return status;
  }

  stop(): void {
    for (const [name, job] of this.jobs.entries()) {
      job.stop?.();
      logger.info(`Stopped key rotation job: ${name}`);
    }
    this.jobs.clear();
  }
}

const keyRotationJob = new KeyRotationJob();
export default keyRotationJob;
