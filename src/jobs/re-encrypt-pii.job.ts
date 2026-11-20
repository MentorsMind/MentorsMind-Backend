import pool from "../config/database";
import { EncryptionUtil } from "../utils/encryption.utils";
import { logger } from "../utils/logger.utils";

const BATCH_SIZE = 100;
const DELAY_MS = 1000;

interface EncryptedUserRow {
  id: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  pii_encryption_version: string | null;
}

interface MfaDeviceRow {
  id: string;
  user_id: string;
  encrypted_secret: string | null;
  pii_encryption_version: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runReEncryptionJob() {
  logger.info("Starting re-encryption job for Google Calendar tokens and MFA TOTP secrets");

  const currentVersion = await EncryptionUtil.getCurrentKeyVersion();
  
  // We expect ENCRYPTION_KEY_V1 (or similar old keys) to be loaded by secrets/env.
  // Actually, wait, reEncrypt takes the old key and new key as strings. 
  // Let's get them from environment variables if we are doing a manual migration.
  const oldKey = process.env.ENCRYPTION_KEY_V1;
  const newKey = process.env.ENCRYPTION_KEY;

  if (!oldKey || !newKey) {
    logger.error("ENCRYPTION_KEY and ENCRYPTION_KEY_V1 must be set for the re-encryption job");
    return;
  }

  // Re-encrypt Google Calendar tokens
  let totalProcessed = 0;
  let hasMore = true;

  while (hasMore) {
    const { rows } = await pool.query<EncryptedUserRow>(
      `SELECT id, encrypted_access_token, encrypted_refresh_token, pii_encryption_version
       FROM users
       WHERE (encrypted_access_token IS NOT NULL OR encrypted_refresh_token IS NOT NULL)
         AND (pii_encryption_version IS NULL OR pii_encryption_version < $1)
       ORDER BY id ASC
       LIMIT $2`,
      [currentVersion, BATCH_SIZE]
    );

    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of rows) {
      let newAccess = row.encrypted_access_token;
      let newRefresh = row.encrypted_refresh_token;

      if (row.encrypted_access_token) {
        try {
          newAccess = await EncryptionUtil.reEncrypt(
            row.encrypted_access_token,
            oldKey,
            newKey,
            currentVersion
          );
        } catch (err) {
          logger.error(`Failed to re-encrypt access token for user ${row.id}`, { error: err });
        }
      }

      if (row.encrypted_refresh_token) {
        try {
          newRefresh = await EncryptionUtil.reEncrypt(
            row.encrypted_refresh_token,
            oldKey,
            newKey,
            currentVersion
          );
        } catch (err) {
          logger.error(`Failed to re-encrypt refresh token for user ${row.id}`, { error: err });
        }
      }

      await pool.query(
        `UPDATE users
         SET encrypted_access_token = $1,
             encrypted_refresh_token = $2,
             pii_encryption_version = $3
         WHERE id = $4`,
        [newAccess, newRefresh, currentVersion, row.id]
      );
    }

    totalProcessed += rows.length;
    
    const remainingRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)
       FROM users
       WHERE (encrypted_access_token IS NOT NULL OR encrypted_refresh_token IS NOT NULL)
         AND (pii_encryption_version IS NULL OR pii_encryption_version < $1)`,
      [currentVersion]
    );
    const remaining = parseInt(remainingRes.rows[0].count, 10);

    logger.info(`reEncrypted users: ${totalProcessed}, remaining: ${remaining}`);

    await sleep(DELAY_MS);
  }

  // Re-encrypt MFA TOTP secrets
  logger.info("Starting re-encryption of MFA TOTP secrets");
  let mfaProcessed = 0;
  let hasMfaMore = true;

  while (hasMfaMore) {
    const { rows } = await pool.query<MfaDeviceRow>(
      `SELECT id, user_id, encrypted_secret, pii_encryption_version
       FROM mfa_devices
       WHERE type = 'totp'
         AND encrypted_secret IS NOT NULL
         AND (pii_encryption_version IS NULL OR pii_encryption_version < $1)
       ORDER BY id ASC
       LIMIT $2`,
      [currentVersion, BATCH_SIZE]
    );

    if (rows.length === 0) {
      hasMfaMore = false;
      break;
    }

    for (const row of rows) {
      if (row.encrypted_secret) {
        try {
          const newSecret = await EncryptionUtil.reEncrypt(
            row.encrypted_secret,
            oldKey,
            newKey,
            currentVersion
          );
          await pool.query(
            `UPDATE mfa_devices
             SET encrypted_secret = $1,
                 pii_encryption_version = $2
             WHERE id = $3`,
            [newSecret, currentVersion, row.id]
          );
        } catch (err) {
          logger.error(`Failed to re-encrypt TOTP secret for device ${row.id}`, { error: err });
        }
      }
    }

    mfaProcessed += rows.length;
    
    const remainingMfaRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)
       FROM mfa_devices
       WHERE type = 'totp'
         AND encrypted_secret IS NOT NULL
         AND (pii_encryption_version IS NULL OR pii_encryption_version < $1)`,
      [currentVersion]
    );
    const remainingMfa = parseInt(remainingMfaRes.rows[0].count, 10);

    logger.info(`reEncrypted MFA devices: ${mfaProcessed}, remaining: ${remainingMfa}`);

    await sleep(DELAY_MS);
  }

  logger.info("Re-encryption job completed", { 
    usersProcessed: totalProcessed,
    mfaDevicesProcessed: mfaProcessed 
  });
}

if (require.main === module) {
  runReEncryptionJob().then(() => process.exit(0)).catch(err => {
    logger.error("Re-encryption job failed", { error: err });
    process.exit(1);
  });
}
