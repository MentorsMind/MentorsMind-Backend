/**
 * UserModel — field-level encryption for sensitive user PII.
 *
 * Sensitive fields (SSN, passport number, payment details) are encrypted
 * at rest using AES-256-GCM via EncryptionUtil.  Plain-text values are
 * never written to the database; only the encrypted ciphertext is stored.
 *
 * Column naming convention:
 *   <field>_encrypted  — stores the ciphertext
 *   pii_encryption_version — tracks the current key version for re-key jobs
 *
 * Encrypted fields:
 *   - ssn                   (Social Security Number)
 *   - passport_number       (Passport / government ID)
 *   - government_id_number  (General government ID)
 *   - bank_account_details  (Bank account / routing numbers)
 *   - payment_method_details (Credit card / payment token data)
 *   - phone_number          (E.164 phone number)
 *   - date_of_birth         (ISO 8601 date)
 *
 * Non-encrypted PII (plain):
 *   - email, first_name, last_name, avatar_url, role, etc.
 */

import pool from '../config/database';
import { EncryptionUtil } from '../utils/encryption.utils';
import { logger } from '../utils/logger.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'user' | 'mentor' | 'admin' | 'moderator';
export type UserStatus = 'active' | 'suspended' | 'deleted' | 'pending';

/** Full user record as stored in the database (ciphertext columns) */
export interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  /** Encrypted SSN ciphertext */
  ssn_encrypted: string | null;
  /** Encrypted passport number ciphertext */
  passport_number_encrypted: string | null;
  /** Encrypted government ID ciphertext */
  government_id_number_encrypted: string | null;
  /** Encrypted bank account details ciphertext (JSON) */
  bank_account_details_encrypted: string | null;
  /** Encrypted payment method details ciphertext (JSON) */
  payment_method_details_encrypted: string | null;
  /** Encrypted phone number ciphertext */
  phone_number_encrypted: string | null;
  /** Encrypted date of birth ciphertext */
  date_of_birth_encrypted: string | null;
  /** Key version used for the above encrypted fields */
  pii_encryption_version: string | null;
  created_at: Date;
  updated_at: Date;
  token_invalid_before: Date | null;
  deletion_completed_at: Date | null;
}

/** Decrypted representation of a user's sensitive fields */
export interface UserSensitiveFields {
  ssn: string | null;
  passportNumber: string | null;
  governmentIdNumber: string | null;
  bankAccountDetails: Record<string, string> | null;
  paymentMethodDetails: Record<string, string> | null;
  phoneNumber: string | null;
  dateOfBirth: string | null;
}

/** Safe public-facing user object (no PII, no ciphertext) */
export interface PublicUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new user with optional sensitive fields */
export interface CreateUserInput {
  id?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  role?: UserRole;
  status?: UserStatus;
  sensitive?: Partial<UserSensitiveFields>;
}

/** Input for updating sensitive fields on an existing user */
export interface UpdateUserSensitiveInput {
  sensitive: Partial<UserSensitiveFields>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Serialize an object to JSON string for encryption, or null */
function serializeObject(value: Record<string, string> | null | undefined): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

/** Deserialize decrypted JSON string back to an object */
function deserializeObject(value: string | null): Record<string, string> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return null;
  }
}

// ─── Model ────────────────────────────────────────────────────────────────────

export const UserModel = {
  /**
   * Create a new user, encrypting all provided sensitive fields.
   */
  async create(input: CreateUserInput): Promise<UserRow> {
    const { v4: uuidv4 } = await import('uuid');
    const id = input.id ?? uuidv4();

    // Encrypt sensitive fields
    const [
      ssnEncrypted,
      passportEncrypted,
      govIdEncrypted,
      bankEncrypted,
      paymentEncrypted,
      phoneEncrypted,
      dobEncrypted,
      keyVersion,
    ] = await Promise.all([
      EncryptionUtil.encrypt(input.sensitive?.ssn ?? null),
      EncryptionUtil.encrypt(input.sensitive?.passportNumber ?? null),
      EncryptionUtil.encrypt(input.sensitive?.governmentIdNumber ?? null),
      EncryptionUtil.encrypt(
        serializeObject(input.sensitive?.bankAccountDetails ?? null),
      ),
      EncryptionUtil.encrypt(
        serializeObject(input.sensitive?.paymentMethodDetails ?? null),
      ),
      EncryptionUtil.encrypt(input.sensitive?.phoneNumber ?? null),
      EncryptionUtil.encrypt(input.sensitive?.dateOfBirth ?? null),
      EncryptionUtil.getCurrentKeyVersion(),
    ]);

    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (
         id, email, first_name, last_name, avatar_url, role, status,
         ssn_encrypted, passport_number_encrypted,
         government_id_number_encrypted, bank_account_details_encrypted,
         payment_method_details_encrypted, phone_number_encrypted,
         date_of_birth_encrypted, pii_encryption_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14, $15
       )
       RETURNING *`,
      [
        id,
        input.email.toLowerCase().trim(),
        input.firstName ?? null,
        input.lastName ?? null,
        input.avatarUrl ?? null,
        input.role ?? 'user',
        input.status ?? 'active',
        ssnEncrypted,
        passportEncrypted,
        govIdEncrypted,
        bankEncrypted,
        paymentEncrypted,
        phoneEncrypted,
        dobEncrypted,
        keyVersion,
      ],
    );

    logger.info('UserModel: user created', { userId: id });
    return rows[0];
  },

  /**
   * Find a user by ID.  Returns the raw row (ciphertext columns).
   * Use `decryptSensitiveFields` to access decrypted values.
   */
  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND deletion_completed_at IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  },

  /**
   * Find a user by email address.
   */
  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await pool.query<UserRow>(
      `SELECT * FROM users
       WHERE email = $1 AND deletion_completed_at IS NULL
       LIMIT 1`,
      [email.toLowerCase().trim()],
    );
    return rows[0] ?? null;
  },

  /**
   * Update only the non-sensitive (plain-text) fields of a user.
   */
  async updateProfile(
    userId: string,
    patch: Partial<Pick<UserRow, 'first_name' | 'last_name' | 'avatar_url' | 'status'>>,
  ): Promise<UserRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const allowed = ['first_name', 'last_name', 'avatar_url', 'status'] as const;
    for (const key of allowed) {
      if (key in patch && patch[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(patch[key]);
      }
    }

    if (!fields.length) return this.findById(userId);

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const { rows } = await pool.query<UserRow>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    return rows[0] ?? null;
  },

  /**
   * Encrypt and persist updated sensitive fields for a user.
   * Only the fields present in `input.sensitive` are updated.
   * Uses a partial UPDATE so unchanged fields are never touched.
   */
  async updateSensitiveFields(
    userId: string,
    input: UpdateUserSensitiveInput,
  ): Promise<UserRow | null> {
    const { sensitive } = input;
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Helper to add a field only if provided in the input
    async function addEncryptedField(
      fieldName: string,
      rawValue: string | null | undefined,
    ): Promise<void> {
      if (rawValue === undefined) return; // not provided — skip
      const encrypted = await EncryptionUtil.encrypt(rawValue);
      fields.push(`${fieldName} = $${idx++}`);
      values.push(encrypted);
    }

    if ('ssn' in sensitive) {
      await addEncryptedField('ssn_encrypted', sensitive.ssn);
    }
    if ('passportNumber' in sensitive) {
      await addEncryptedField('passport_number_encrypted', sensitive.passportNumber);
    }
    if ('governmentIdNumber' in sensitive) {
      await addEncryptedField('government_id_number_encrypted', sensitive.governmentIdNumber);
    }
    if ('bankAccountDetails' in sensitive) {
      await addEncryptedField(
        'bank_account_details_encrypted',
        serializeObject(sensitive.bankAccountDetails ?? null),
      );
    }
    if ('paymentMethodDetails' in sensitive) {
      await addEncryptedField(
        'payment_method_details_encrypted',
        serializeObject(sensitive.paymentMethodDetails ?? null),
      );
    }
    if ('phoneNumber' in sensitive) {
      await addEncryptedField('phone_number_encrypted', sensitive.phoneNumber);
    }
    if ('dateOfBirth' in sensitive) {
      await addEncryptedField('date_of_birth_encrypted', sensitive.dateOfBirth);
    }

    if (!fields.length) return this.findById(userId);

    // Update key version to current
    const currentVersion = await EncryptionUtil.getCurrentKeyVersion();
    fields.push(`pii_encryption_version = $${idx++}`);
    values.push(currentVersion);
    fields.push('updated_at = NOW()');
    values.push(userId);

    const { rows } = await pool.query<UserRow>(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );

    logger.info('UserModel: sensitive fields updated', { userId });
    return rows[0] ?? null;
  },

  /**
   * Decrypt all sensitive fields from a UserRow.
   * Returns null for any field that is not set or fails decryption.
   */
  async decryptSensitiveFields(
    user: UserRow,
  ): Promise<UserSensitiveFields> {
    const [
      ssn,
      passportNumber,
      governmentIdNumber,
      bankRaw,
      paymentRaw,
      phoneNumber,
      dateOfBirth,
    ] = await Promise.all([
      safeDecrypt(user.ssn_encrypted),
      safeDecrypt(user.passport_number_encrypted),
      safeDecrypt(user.government_id_number_encrypted),
      safeDecrypt(user.bank_account_details_encrypted),
      safeDecrypt(user.payment_method_details_encrypted),
      safeDecrypt(user.phone_number_encrypted),
      safeDecrypt(user.date_of_birth_encrypted),
    ]);

    return {
      ssn,
      passportNumber,
      governmentIdNumber,
      bankAccountDetails: deserializeObject(bankRaw),
      paymentMethodDetails: deserializeObject(paymentRaw),
      phoneNumber,
      dateOfBirth,
    };
  },

  /**
   * Re-encrypt all sensitive fields for a user under the current key version.
   * Called by the key-rotation re-encryption job.
   */
  async reEncryptUser(userId: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user) return false;

    const decrypted = await this.decryptSensitiveFields(user);
    await this.updateSensitiveFields(userId, { sensitive: decrypted });

    logger.info('UserModel: user re-encrypted under new key', { userId });
    return true;
  },

  /**
   * Returns a safe, public-facing user object with no PII or ciphertext.
   */
  toPublicUser(user: UserRow): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      role: user.role,
      status: user.status,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  },

  /**
   * Find users whose PII is encrypted with an older key version.
   * Used by the re-encryption job to find records that need rotation.
   */
  async findUsersWithOldKeyVersion(
    currentVersion: string,
    batchSize = 100,
    offset = 0,
  ): Promise<Array<{ id: string; pii_encryption_version: string | null }>> {
    const { rows } = await pool.query<{
      id: string;
      pii_encryption_version: string | null;
    }>(
      `SELECT id, pii_encryption_version
       FROM users
       WHERE deletion_completed_at IS NULL
         AND (
           pii_encryption_version IS NULL
           OR pii_encryption_version != $1
         )
         AND (
           ssn_encrypted IS NOT NULL
           OR passport_number_encrypted IS NOT NULL
           OR government_id_number_encrypted IS NOT NULL
           OR bank_account_details_encrypted IS NOT NULL
           OR payment_method_details_encrypted IS NOT NULL
           OR phone_number_encrypted IS NOT NULL
           OR date_of_birth_encrypted IS NOT NULL
         )
       ORDER BY id
       LIMIT $2 OFFSET $3`,
      [currentVersion, batchSize, offset],
    );
    return rows;
  },
};

// ─── Private helpers ─────────────────────────────────────────────────────────

async function safeDecrypt(
  ciphertext: string | null | undefined,
): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    return await EncryptionUtil.decrypt(ciphertext);
  } catch (err: any) {
    logger.error('UserModel: decryption failed', { error: err.message });
    return null;
  }
}

export default UserModel;
