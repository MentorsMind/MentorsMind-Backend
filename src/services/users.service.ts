import pool, { db } from "../config/database";
import { EncryptionUtil } from "../utils/encryption.utils";
import { CacheService } from "./cache.service";
import { CacheKeys, CacheTTL } from "../utils/cache-key.utils";
import { LoyaltyService } from "./loyalty.service";

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
    private readonly pool: any,
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

export interface UserStats {
  totalSessions: number;
  upcomingSessions: number;
  averageRatingGiven: number | null;
  totalSpent: number | null;
  loyaltyTier: string;
  streakDays: number | null;
}

async function computeStreakDays(userId: string): Promise<number | null> {
  const { rows } = await db.query<{ day: string }>(
    `SELECT DISTINCT scheduled_at::date AS day FROM sessions
     WHERE (mentor_id = $1 OR mentee_id = $1) AND status = 'completed'
     ORDER BY day DESC LIMIT 60`,
    [userId],
  );
  if (rows.length === 0) return null;
  const days = new Set(rows.map((r) => new Date(r.day).toISOString().slice(0, 10)));
  const today = new Date();
  let streak = 0;
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // Allow streak to start yesterday (today's session may not have happened yet).
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

async function computeUserStats(userId: string): Promise<UserStats> {
  const [
    totalSessionsRow,
    upcomingSessionsRow,
    averageRatingRow,
    totalSpentRow,
    loyalty,
    streakDays,
  ] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM sessions WHERE (mentor_id = $1 OR mentee_id = $1) AND status = 'completed'`,
      [userId],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM sessions WHERE (mentor_id = $1 OR mentee_id = $1) AND status IN ('pending', 'confirmed') AND scheduled_at > NOW()`,
      [userId],
    ),
    db.query<{ avg: string | null }>(
      `SELECT AVG(rating)::text AS avg FROM reviews WHERE reviewer_id = $1`,
      [userId],
    ),
    db.query<{ total: string | null; count: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total, COUNT(*) AS count FROM transactions WHERE user_id = $1 AND status = 'completed'`,
      [userId],
    ),
    LoyaltyService.getOrCreateAccount(userId).catch(() => null),
    computeStreakDays(userId),
  ]);

  const totalSessions = parseInt(totalSessionsRow.rows[0]?.count ?? "0", 10);
  const upcomingSessions = parseInt(upcomingSessionsRow.rows[0]?.count ?? "0", 10);
  const averageRatingGiven =
    averageRatingRow.rows[0]?.avg !== null && averageRatingRow.rows[0]?.avg !== undefined
      ? parseFloat(averageRatingRow.rows[0].avg as string)
      : null;
  const hasPayments = parseInt(totalSpentRow.rows[0]?.count ?? "0", 10) > 0;
  const totalSpent = hasPayments ? parseFloat(totalSpentRow.rows[0]?.total ?? "0") : null;

  return {
    totalSessions,
    upcomingSessions,
    averageRatingGiven,
    totalSpent,
    loyaltyTier: loyalty?.tier ?? "bronze",
    streakDays,
  };
}

export const UsersService = {
  ...reader,
  ...writer,
  async getUserStats(userId: string): Promise<UserStats> {
    // 5-minute per-user cache (CacheTTL.medium = 300s).
    return CacheService.wrap(CacheKeys.userStats(userId), CacheTTL.medium, () =>
      computeUserStats(userId),
    );
  },
};
