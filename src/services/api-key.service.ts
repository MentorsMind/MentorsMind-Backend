import {
  ApiKeyModel,
  CreateApiKeyPayload,
  ApiKey,
} from "../models/api-key.model";
import { createError } from "../middleware/errorHandler";
import pool from "../config/database";
import { redis } from "../config/redis";
import { logAuditEvent } from "../utils/audit.utils";

const VALID_SCOPES = [
  "bookings:read",
  "bookings:write",
  "sessions:read",
  "sessions:write",
  "users:read",
  "mentors:read",
  "payments:read",
  "reviews:read",
  "webhooks:write",
  "webhooks:manage",
  "messaging:write",
  "*", // All permissions
];

interface ApiKeyUsageStats {
  totalRequests: number;
  last24Hours: number;
  last7Days: number;
  last30Days: number;
  topEndpoints: Array<{ endpoint: string; count: number }>;
  recentActivity: Array<{
    timestamp: Date;
    endpoint: string;
    method: string;
    statusCode?: number;
  }>;
}

export const ApiKeyService = {
  async create(
    userId: string,
    payload: Omit<CreateApiKeyPayload, "userId">,
  ): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const invalidScopes = payload.scopes.filter(
      (s) => !VALID_SCOPES.includes(s),
    );
    if (invalidScopes.length) {
      throw createError(`Invalid scopes: ${invalidScopes.join(", ")}`, 400);
    }

    const result = await ApiKeyModel.create({ ...payload, userId });

    // Log API key creation
    await logAuditEvent({
      userId,
      action: "API_KEY_CREATED" as any,
      resourceType: "api_key",
      resourceId: result.apiKey.id,
      metadata: {
        name: payload.name,
        scopes: payload.scopes,
        rateLimit: payload.rateLimit,
      },
    });

    return result;
  },

  async list(userId: string): Promise<ApiKey[]> {
    return ApiKeyModel.findByUser(userId);
  },

  async revoke(id: string, userId: string): Promise<void> {
    const key = await ApiKeyModel.findById(id, userId);
    if (!key) {
      throw createError("API key not found or not owned by user", 404);
    }

    const revoked = await ApiKeyModel.revoke(id, userId);
    if (!revoked) {
      throw createError("Failed to revoke API key", 500);
    }

    // Invalidate cache
    const { invalidateApiKeyCache } = await import("../middleware/api-key.middleware");
    // We need to get the hash from the key_hash column
    const { rows } = await pool.query<{ key_hash: string }>(
      `SELECT key_hash FROM integration_api_keys WHERE id = $1`,
      [id]
    );
    if (rows[0]) {
      await invalidateApiKeyCache(rows[0].key_hash);
    }

    // Log revocation
    await logAuditEvent({
      userId,
      action: "API_KEY_REVOKED" as any,
      resourceType: "api_key",
      resourceId: id,
      metadata: {
        name: key.name,
      },
    });
  },

  async rotate(id: string, userId: string): Promise<{ apiKey: ApiKey; plainKey: string }> {
    const existingKey = await ApiKeyModel.findById(id, userId);
    if (!existingKey) {
      throw createError("API key not found or not owned by user", 404);
    }

    // Rotate the key (atomic replacement)
    const result = await ApiKeyModel.rotate(id, userId);

    // Log rotation
    await logAuditEvent({
      userId,
      action: "API_KEY_ROTATED" as any,
      resourceType: "api_key",
      resourceId: id,
      metadata: {
        name: existingKey.name,
        oldKeyPrefix: existingKey.key_prefix,
        newKeyPrefix: result.apiKey.key_prefix,
      },
    });

    return result;
  },

  async getUsageStats(id: string, userId: string): Promise<ApiKeyUsageStats> {
    // Verify ownership
    const key = await ApiKeyModel.findById(id, userId);
    if (!key) {
      throw createError("API key not found or not owned by user", 404);
    }

    // Get usage statistics from audit logs
    const { rows: stats } = await pool.query<{
      total_requests: string;
      last_24h: string;
      last_7d: string;
      last_30d: string;
    }>(
      `SELECT 
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as last_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as last_7d,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last_30d
       FROM audit_logs
       WHERE resource_type = 'api_key' 
         AND resource_id = $1 
         AND action = 'API_KEY_USED'`,
      [id]
    );

    // Get top endpoints
    const { rows: endpoints } = await pool.query<{ endpoint: string; count: string }>(
      `SELECT 
        metadata->>'endpoint' as endpoint,
        COUNT(*) as count
       FROM audit_logs
       WHERE resource_type = 'api_key' 
         AND resource_id = $1 
         AND action = 'API_KEY_USED'
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY metadata->>'endpoint'
       ORDER BY count DESC
       LIMIT 10`,
      [id]
    );

    // Get recent activity
    const { rows: activity } = await pool.query<{
      created_at: Date;
      endpoint: string;
      method: string;
    }>(
      `SELECT 
        created_at as timestamp,
        metadata->>'endpoint' as endpoint,
        metadata->>'method' as method
       FROM audit_logs
       WHERE resource_type = 'api_key' 
         AND resource_id = $1 
         AND action IN ('API_KEY_USED', 'API_KEY_PERMISSION_DENIED', 'API_KEY_RATE_LIMIT_EXCEEDED')
       ORDER BY created_at DESC
       LIMIT 50`,
      [id]
    );

    const statsRow = stats[0];
    return {
      totalRequests: parseInt(statsRow?.total_requests ?? "0", 10),
      last24Hours: parseInt(statsRow?.last_24h ?? "0", 10),
      last7Days: parseInt(statsRow?.last_7d ?? "0", 10),
      last30Days: parseInt(statsRow?.last_30d ?? "0", 10),
      topEndpoints: endpoints.map((e) => ({
        endpoint: e.endpoint,
        count: parseInt(e.count, 10),
      })),
      recentActivity: activity.map((a) => ({
        timestamp: a.created_at,
        endpoint: a.endpoint,
        method: a.method,
      })),
    };
  },

  listScopes(): string[] {
    return VALID_SCOPES;
  },

  async authenticate(rawKey: string) {
    return ApiKeyModel.authenticate(rawKey);
  },
};
