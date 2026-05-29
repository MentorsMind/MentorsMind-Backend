import crypto from "crypto";
import pool from "../config/database";

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string; // first 8 chars shown to user for identification
  scopes: string[];
  rate_limit: number;
  is_active: boolean;
  description: string | null;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface CreateApiKeyPayload {
  userId: string;
  name: string;
  scopes: string[];
  rateLimit?: number;
  description?: string;
  expiresAt?: Date;
}

const PROVIDER = "public";

export const ApiKeyModel = {
  /** Generate a new API key, store hashed, return the plain key (shown once) */
  async create(
    payload: CreateApiKeyPayload,
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const rawKey = `mm_${crypto.randomBytes(24).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 10);

    const { rows } = await pool.query<{
      id: string;
      owner_user_id: string;
      name: string;
      scopes: string[];
      rate_limit: number;
      is_active: boolean;
      description: string | null;
      last_used_at: Date | null;
      expires_at: Date | null;
      created_at: Date;
    }>(
      `INSERT INTO integration_api_keys
         (owner_user_id, name, provider, key_hash, scopes, rate_limit, description, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, owner_user_id, name, scopes, rate_limit, is_active, description, last_used_at, expires_at, created_at`,
      [
        payload.userId,
        payload.name,
        PROVIDER,
        keyHash,
        payload.scopes,
        payload.rateLimit ?? 1000,
        payload.description ?? null,
        payload.expiresAt ?? null,
        JSON.stringify({ key_prefix: keyPrefix }),
      ],
    );

    const row = rows[0];
    return {
      plainKey: rawKey,
      apiKey: {
        id: row.id,
        user_id: row.owner_user_id,
        name: row.name,
        key_prefix: keyPrefix,
        scopes: row.scopes,
        rate_limit: row.rate_limit,
        is_active: row.is_active,
        description: row.description,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        created_at: row.created_at,
      },
    };
  },

  async findByUser(userId: string): Promise<ApiKey[]> {
    const { rows } = await pool.query(
      `SELECT id, owner_user_id AS user_id, name, scopes, rate_limit, is_active,
              description, last_used_at, expires_at, created_at,
              metadata->>'key_prefix' AS key_prefix
       FROM integration_api_keys
       WHERE owner_user_id = $1 AND provider = $2
       ORDER BY created_at DESC`,
      [userId, PROVIDER],
    );
    return rows;
  },

  async revoke(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `UPDATE integration_api_keys SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND owner_user_id = $2 AND provider = $3`,
      [id, userId, PROVIDER],
    );
    return (rowCount ?? 0) > 0;
  },

  async authenticate(
    rawKey: string,
  ): Promise<{ id: string; userId: string; scopes: string[] } | null> {
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const { rows } = await pool.query(
      `SELECT id, owner_user_id, scopes, expires_at
       FROM integration_api_keys
       WHERE key_hash = $1 AND provider = $2 AND is_active = TRUE`,
      [keyHash, PROVIDER],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;

    await pool.query(
      `UPDATE integration_api_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    return { id: row.id, userId: row.owner_user_id, scopes: row.scopes };
  },
};
