import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';
import pool from '../config/database';
import { EncryptionUtil } from '../utils/encryption.utils';
import { env } from '../config/env';
import bcrypt from 'bcryptjs';

const authenticator = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

export const MfaService = {
  /**
   * Generate a new TOTP secret for a user.
   */
  generateSecret(): string {
    return authenticator.generateSecret();
  },

  /**
   * Generate a QR code DataURL for the authenticator app.
   */
  async generateQrCode(email: string, secret: string): Promise<string> {
    const otpauth = authenticator.toURI({
        label: email,
        issuer: env.MFA_TOTP_ISSUER,
        secret
    });
    return QRCode.toDataURL(otpauth);
  },

  /**
   * Verify a TOTP token against a secret.
   */
  async verifyToken(token: string, secret: string): Promise<boolean> {
    const result = await authenticator.verify(token, { secret });
    return result.valid;
  },

  /**
   * Encrypt a secret for storage.
   */
  encryptSecret(secret: string): string {
    return EncryptionUtil.encrypt(secret);
  },

  /**
   * Decrypt a secret from storage.
   */
  decryptSecret(encryptedSecret: string): string {
    return EncryptionUtil.decrypt(encryptedSecret);
  },

  /**
   * Generate 8 single-use backup codes.
   * Returns plain codes for the user and hashed versions for storage.
   */
  generateBackupCodes(): { plain: string[]; hashed: string[] } {
    const plain: string[] = [];
    const hashed: string[] = [];

    for (let i = 0; i < 8; i++) {
        const code = crypto.randomBytes(4).toString('hex'); // 8 char alphanumeric-ish
        plain.push(code);
        // Using bcrypt for hashing backup codes
        const salt = bcrypt.genSaltSync(10);
        hashed.push(bcrypt.hashSync(code, salt));
    }

    return { plain, hashed };
  },

  /**
   * Verify and consume a backup code.
   */
  async verifyAndConsumeBackupCode(userId: string, code: string): Promise<boolean> {
    const query = `SELECT mfa_backup_codes FROM users WHERE id = $1`;
    const { rows } = await pool.query(query, [userId]);

    if (!rows.length || !rows[0].mfa_backup_codes) {
        return false;
    }

    const hashedCodes: string[] = rows[0].mfa_backup_codes;
    let foundIndex = -1;

    for (let i = 0; i < hashedCodes.length; i++) {
        if (bcrypt.compareSync(code, hashedCodes[i])) {
            foundIndex = i;
            break;
        }
    }

    if (foundIndex === -1) {
        return false;
    }

    // Remove the used code
    const updatedCodes = hashedCodes.filter((_, index) => index !== foundIndex);
    await pool.query(
        `UPDATE users SET mfa_backup_codes = $1 WHERE id = $2`,
        [updatedCodes, userId]
    );

    return true;
  }
};
