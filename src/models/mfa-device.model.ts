import pool from "../config/database";

export type MfaDeviceType = 'totp' | 'sms' | 'email' | 'webauthn';
export type AuthenticatorAttachment = 'platform' | 'cross-platform' | null;

export interface MfaDevice {
  id: string;
  user_id: string;
  type: MfaDeviceType;
  name: string | null;
  credential_id: Buffer | null;
  credential_public_key: Buffer | null;
  credential_transports: string[] | null;
  authenticator_attachment: AuthenticatorAttachment;
  aaguid: string | null;
  sign_count: number;
  phone_number: string | null;
  email_address: string | null;
  encrypted_secret: string | null;
  backup_codes_hashed: string[] | null;
  is_primary: boolean;
  is_active: boolean;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateWebAuthnDevicePayload {
  userId: string;
  name?: string;
  credentialId: Buffer;
  credentialPublicKey: Buffer;
  credentialTransports?: string[];
  authenticatorAttachment?: AuthenticatorAttachment;
  aaguid?: string;
  signCount?: number;
}

export interface CreateTotpDevicePayload {
  userId: string;
  name?: string;
  encryptedSecret: string;
  backupCodesHashed?: string[];
}

export interface CreateSmsDevicePayload {
  userId: string;
  name?: string;
  phoneNumber: string;
}

export interface CreateEmailDevicePayload {
  userId: string;
  name?: string;
  emailAddress: string;
}

export interface MfaChallenge {
  id: string;
  user_id: string | null;
  challenge: string;
  type: 'webauthn_register' | 'webauthn_authenticate' | 'sms' | 'email';
  payload: Record<string, any> | null;
  expires_at: Date;
  created_at: Date;
}

export const MfaDeviceModel = {
  // ─── WebAuthn Device ──────────────────────────────────────────────────────

  async createWebAuthn(payload: CreateWebAuthnDevicePayload): Promise<MfaDevice> {
    const { rows } = await pool.query<MfaDevice>(
      `INSERT INTO mfa_devices
         (user_id, type, name, credential_id, credential_public_key,
          credential_transports, authenticator_attachment, aaguid, sign_count)
       VALUES ($1, 'webauthn', $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        payload.userId,
        payload.name ?? null,
        payload.credentialId,
        payload.credentialPublicKey,
        payload.credentialTransports ?? null,
        payload.authenticatorAttachment ?? null,
        payload.aaguid ?? null,
        payload.signCount ?? 0,
      ],
    );
    return rows[0];
  },

  async findWebAuthnByCredentialId(credentialId: Buffer): Promise<MfaDevice | null> {
    const { rows } = await pool.query<MfaDevice>(
      `SELECT * FROM mfa_devices WHERE credential_id = $1 AND is_active = TRUE`,
      [credentialId],
    );
    return rows[0] ?? null;
  },

  async updateSignCount(id: string, signCount: number): Promise<void> {
    await pool.query(
      `UPDATE mfa_devices SET sign_count = $1, last_used_at = NOW() WHERE id = $2`,
      [signCount, id],
    );
  },

  // ─── TOTP Device ──────────────────────────────────────────────────────────

  async createTotp(payload: CreateTotpDevicePayload): Promise<MfaDevice> {
    const { rows } = await pool.query<MfaDevice>(
      `INSERT INTO mfa_devices
         (user_id, type, name, encrypted_secret, backup_codes_hashed)
       VALUES ($1, 'totp', $2, $3, $4)
       RETURNING *`,
      [
        payload.userId,
        payload.name ?? null,
        payload.encryptedSecret,
        payload.backupCodesHashed ?? null,
      ],
    );
    return rows[0];
  },

  // ─── SMS Device ───────────────────────────────────────────────────────────

  async createSms(payload: CreateSmsDevicePayload): Promise<MfaDevice> {
    const { rows } = await pool.query<MfaDevice>(
      `INSERT INTO mfa_devices
         (user_id, type, name, phone_number)
       VALUES ($1, 'sms', $2, $3)
       RETURNING *`,
      [payload.userId, payload.name ?? null, payload.phoneNumber],
    );
    return rows[0];
  },

  // ─── Email Device ─────────────────────────────────────────────────────────

  async createEmail(payload: CreateEmailDevicePayload): Promise<MfaDevice> {
    const { rows } = await pool.query<MfaDevice>(
      `INSERT INTO mfa_devices
         (user_id, type, name, email_address)
       VALUES ($1, 'email', $2, $3)
       RETURNING *`,
      [payload.userId, payload.name ?? null, payload.emailAddress],
    );
    return rows[0];
  },

  // ─── Generic Queries ──────────────────────────────────────────────────────

  async listByUser(userId: string): Promise<MfaDevice[]> {
    const { rows } = await pool.query<MfaDevice>(
      `SELECT * FROM mfa_devices WHERE user_id = $1 ORDER BY is_primary DESC, created_at ASC`,
      [userId],
    );
    return rows;
  },

  async listByUserAndType(userId: string, type: MfaDeviceType): Promise<MfaDevice[]> {
    const { rows } = await pool.query<MfaDevice>(
      `SELECT * FROM mfa_devices WHERE user_id = $1 AND type = $2 AND is_active = TRUE ORDER BY is_primary DESC`,
      [userId, type],
    );
    return rows;
  },

  async findById(id: string, userId?: string): Promise<MfaDevice | null> {
    const query = userId
      ? `SELECT * FROM mfa_devices WHERE id = $1 AND user_id = $2`
      : `SELECT * FROM mfa_devices WHERE id = $1`;
    const params = userId ? [id, userId] : [id];
    const { rows } = await pool.query<MfaDevice>(query, params);
    return rows[0] ?? null;
  },

  async setPrimary(id: string, userId: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE mfa_devices SET is_primary = FALSE WHERE user_id = $1`,
        [userId],
      );
      const { rowCount } = await client.query(
        `UPDATE mfa_devices SET is_primary = TRUE WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      await client.query('COMMIT');
      return (rowCount ?? 0) > 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async deactivate(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE mfa_devices SET is_active = FALSE WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  async remove(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM mfa_devices WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  async rename(id: string, userId: string, name: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE mfa_devices SET name = $1 WHERE id = $2 AND user_id = $3`,
      [name, id, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  async touchLastUsed(id: string): Promise<void> {
    await pool.query(
      `UPDATE mfa_devices SET last_used_at = NOW() WHERE id = $1`,
      [id],
    );
  },

  async countActive(userId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM mfa_devices WHERE user_id = $1 AND is_active = TRUE`,
      [userId],
    );
    return parseInt(rows[0].count, 10);
  },

  async hasActiveOfType(userId: string, type: MfaDeviceType): Promise<boolean> {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM mfa_devices WHERE user_id = $1 AND type = $2 AND is_active = TRUE)`,
      [userId, type],
    );
    return rows[0].exists;
  },

  // ─── Challenges ───────────────────────────────────────────────────────────

  async storeChallenge(params: {
    userId: string | null;
    challenge: string;
    type: MfaChallenge['type'];
    payload?: Record<string, any>;
    ttlSeconds: number;
  }): Promise<MfaChallenge> {
    const { rows } = await pool.query<MfaChallenge>(
      `INSERT INTO mfa_challenges (user_id, challenge, type, payload, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 second'))
       RETURNING *`,
      [
        params.userId,
        params.challenge,
        params.type,
        params.payload ? JSON.stringify(params.payload) : null,
        params.ttlSeconds,
      ],
    );
    return rows[0];
  },

  async getAndConsumeChallenge(
    challenge: string,
    type: MfaChallenge['type'],
  ): Promise<MfaChallenge | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<MfaChallenge>(
        `SELECT * FROM mfa_challenges
         WHERE challenge = $1 AND type = $2 AND expires_at > NOW()
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [challenge, type],
      );
      if (!rows.length) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(`DELETE FROM mfa_challenges WHERE id = $1`, [rows[0].id]);
      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async cleanupExpiredChallenges(): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM mfa_challenges WHERE expires_at < NOW() - INTERVAL '1 hour'`,
    );
    return rowCount ?? 0;
  },
};
