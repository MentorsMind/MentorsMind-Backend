import crypto from "crypto";
import bcrypt from "bcryptjs";
import pool from "../config/database";
import { createError } from "../middleware/errorHandler";

const OTP_TTL_MINUTES = 10;

export const MfaOtpService = {
  /** Generate a 6-digit OTP, store hashed, return plain code */
  async generateOtp(userId: string, method: "sms" | "email"): Promise<string> {
    const code = String(Math.floor(100000 + crypto.randomInt(900000)));
    const hash = bcrypt.hashSync(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Invalidate previous unused codes for this user+method
    await pool.query(
      `UPDATE mfa_otp_codes SET used = TRUE
       WHERE user_id = $1 AND method = $2 AND used = FALSE`,
      [userId, method],
    );

    await pool.query(
      `INSERT INTO mfa_otp_codes (user_id, code_hash, method, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, hash, method, expiresAt],
    );

    return code;
  },

  /** Verify and consume an OTP */
  async verifyOtp(
    userId: string,
    method: "sms" | "email",
    code: string,
  ): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT id, code_hash FROM mfa_otp_codes
       WHERE user_id = $1 AND method = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 5`,
      [userId, method],
    );

    for (const row of rows) {
      if (bcrypt.compareSync(code, row.code_hash)) {
        await pool.query(`UPDATE mfa_otp_codes SET used = TRUE WHERE id = $1`, [
          row.id,
        ]);
        return true;
      }
    }
    return false;
  },

  /** Enable SMS/email MFA for a user */
  async enableOtpMfa(
    userId: string,
    method: "sms" | "email",
    phone?: string,
  ): Promise<void> {
    if (method === "sms" && !phone) {
      throw createError("Phone number required for SMS MFA", 400);
    }
    const { plain, hashed } = generateBackupCodes();
    await pool.query(
      `UPDATE users
       SET mfa_enabled = TRUE, mfa_method = $1, mfa_phone = $2,
           mfa_backup_codes = $3, mfa_secret = NULL
       WHERE id = $4`,
      [method, phone ?? null, hashed, userId],
    );
    return plain as any; // caller receives backup codes
  },

  async enableOtpMfaWithCodes(
    userId: string,
    method: "sms" | "email",
    phone?: string,
  ): Promise<string[]> {
    if (method === "sms" && !phone) {
      throw createError("Phone number required for SMS MFA", 400);
    }
    const { plain, hashed } = generateBackupCodes();
    await pool.query(
      `UPDATE users
       SET mfa_enabled = TRUE, mfa_method = $1, mfa_phone = $2,
           mfa_backup_codes = $3, mfa_secret = NULL
       WHERE id = $4`,
      [method, phone ?? null, hashed, userId],
    );
    return plain;
  },
};

function generateBackupCodes(): { plain: string[]; hashed: string[] } {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < 8; i++) {
    const code = crypto.randomBytes(4).toString("hex");
    plain.push(code);
    hashed.push(bcrypt.hashSync(code, 10));
  }
  return { plain, hashed };
}
