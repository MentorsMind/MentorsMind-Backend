import pool, { db } from "../config/database";
import { EncryptionUtil } from "../utils/encryption.utils";

export type UserTier = "free" | "pro" | "enterprise";

export interface UserRecord {
  id: string;
  email: string;
  role: string;
  user_tier: UserTier;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  notification_preferences: Record<string, Record<string, boolean>>;
  phone_number: string | null;
  date_of_birth: string | null;
  government_id_number: string | null;
  bank_account_details: string | null;
  pii_encryption_version: string | null;
  created_at: Date;
  updated_at: Date;
  language: string;
}

export interface PublicUserRecord {
  id: string;
  role: string;
  first_name: string;
  last_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export interface UpdateUserPayload {
  firstName?: string;
  lastName?: string;
  bio?: string;
  notificationPreferences?: Record<string, Record<string, boolean>>;
  phoneNumber?: string | null;
  dateOfBirth?: string | null;
  governmentIdNumber?: string | null;
  bankAccountDetails?: string | null;
  language?: string;
}

const PRIVATE_COLUMNS = `id, email, role, user_tier, first_name, last_name, bio, avatar_url, is_active,
   notification_preferences, phone_number_encrypted, date_of_birth_encrypted,
   government_id_number_encrypted, bank_account_details_encrypted,
   pii_encryption_version, created_at, updated_at, language`;

const PUBLIC_COLUMNS = "id, role, first_name, last_name, bio, avatar_url";

export interface IUserReader {
  findById(id: string): Promise<UserRecord | null>;
  findPublicById(id: string): Promise<PublicUserRecord | null>;
  findPublicByIds(ids: string[]): Promise<PublicUserRecord[]>;
  getNotificationPreferences(
    id: string,
  ): Promise<Record<string, Record<string, boolean>> | null>;
}

export interface IUserWriter {
  update(id: string, payload: UpdateUserPayload): Promise<UserRecord | null>;
  updateAvatar(id: string, avatarUrl: string): Promise<UserRecord | null>;
  deactivate(id: string): Promise<boolean>;
}

export interface IUserMapper {
  mapPrivateRow(row: any): Promise<UserRecord>;
}

export class UserReader implements IUserReader {
  constructor(private readonly db: typeof db, private readonly mapper: IUserMapper) {}

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.db.query(
      `SELECT ${PRIVATE_COLUMNS} FROM users WHERE id = $1 AND is_active = true`,
      [id],
    );
    return rows[0] ? await this.mapper.mapPrivateRow(rows[0]) : null;
  }

  async findPublicById(id: string): Promise<PublicUserRecord | null> {
    const { rows } = await this.db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 AND is_active = true`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findPublicByIds(ids: string[]): Promise<PublicUserRecord[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ANY($1) AND is_active = true`,
      [ids],
    );
    return rows;
  }

  async getNotificationPreferences(
    id: string,
  ): Promise<Record<string, Record<string, boolean>> | null> {
    const { rows } = await pool.query<{
      notification_preferences: Record<string, Record<string, boolean>>;
    }>(
      `SELECT notification_preferences FROM users WHERE id = $1 AND is_active = true`,
      [id],
    );
    return rows[0]?.notification_preferences ?? null;
  }
}

export class UserWriter implements IUserWriter {
  constructor(
    private readonly pool: typeof pool,
    private readonly encryption: typeof EncryptionUtil,
    private readonly mapper: IUserMapper,
    private readonly reader: IUserReader,
  ) {}

  async update(
    id: string,
    payload: UpdateUserPayload,
  ): Promise<UserRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (payload.firstName !== undefined) {
      fields.push(`first_name = $${idx++}`);
      values.push(payload.firstName);
    }
    if (payload.lastName !== undefined) {
      fields.push(`last_name = $${idx++}`);
      values.push(payload.lastName);
    }
    if (payload.bio !== undefined) {
      fields.push(`bio = $${idx++}`);
      values.push(payload.bio);
    }
    if (payload.notificationPreferences !== undefined) {
      fields.push(`notification_preferences = $${idx++}`);
      values.push(JSON.stringify(payload.notificationPreferences));
    }
    if (payload.language !== undefined) {
      fields.push(`language = $${idx++}`);
      values.push(payload.language);
    }
    if (payload.phoneNumber !== undefined) {
      fields.push(`phone_number_encrypted = $${idx++}`);
      values.push(await this.encryption.encrypt(payload.phoneNumber));
    }
    if (payload.dateOfBirth !== undefined) {
      fields.push(`date_of_birth_encrypted = $${idx++}`);
      values.push(await this.encryption.encrypt(payload.dateOfBirth));
    }
    if (payload.governmentIdNumber !== undefined) {
      fields.push(`government_id_number_encrypted = $${idx++}`);
      values.push(await this.encryption.encrypt(payload.governmentIdNumber));
    }
    if (payload.bankAccountDetails !== undefined) {
      fields.push(`bank_account_details_encrypted = $${idx++}`);
      values.push(await this.encryption.encrypt(payload.bankAccountDetails));
    }

    if (
      payload.phoneNumber !== undefined ||
      payload.dateOfBirth !== undefined ||
      payload.governmentIdNumber !== undefined ||
      payload.bankAccountDetails !== undefined
    ) {
      fields.push(`pii_encryption_version = $${idx++}`);
      values.push(await this.encryption.getCurrentKeyVersion());
    }

    if (fields.length === 0) {
      return this.reader.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await this.pool.query<any>(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx} AND is_active = true
       RETURNING ${PRIVATE_COLUMNS}`,
      values,
    );
    return rows[0] ? await this.mapper.mapPrivateRow(rows[0]) : null;
  }

  async updateAvatar(
    id: string,
    avatarUrl: string,
  ): Promise<UserRecord | null> {
    const { rows } = await this.pool.query<any>(
      `UPDATE users SET avatar_url = $1, updated_at = NOW()
       WHERE id = $2 AND is_active = true
       RETURNING ${PRIVATE_COLUMNS}`,
      [avatarUrl, id],
    );
    return rows[0] ? await this.mapper.mapPrivateRow(rows[0]) : null;
  }

  async deactivate(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_active = true`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}

export class UserMapper implements IUserMapper {
  constructor(private readonly encryption: typeof EncryptionUtil) {}

  async mapPrivateRow(row: any): Promise<UserRecord> {
    const {
      phone_number_encrypted,
      date_of_birth_encrypted,
      government_id_number_encrypted,
      bank_account_details_encrypted,
      ...rest
    } = row;

    return {
      ...rest,
      phone_number: await this.encryption.decrypt(phone_number_encrypted),
      date_of_birth: await this.encryption.decrypt(date_of_birth_encrypted),
      government_id_number: await this.encryption.decrypt(
        government_id_number_encrypted,
      ),
      bank_account_details: await this.encryption.decrypt(
        bank_account_details_encrypted,
      ),
    };
  }
}

const mapper = new UserMapper(EncryptionUtil);
const reader = new UserReader(db, mapper);
const writer = new UserWriter(pool, EncryptionUtil, mapper, reader);

export const UsersService = {
  ...reader,
  ...writer,
};
