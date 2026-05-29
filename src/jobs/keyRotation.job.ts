import pool from "../config/database";
import { EncryptionUtil } from "../utils/encryption.utils";
import { logger } from "../utils/logger.utils";

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

export const keyRotationJob = {
  async run(): Promise<{ 
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
  },

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
  },

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
  },

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
  },
};
