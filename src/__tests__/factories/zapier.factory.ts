/**
 * Zapier test factory.
 *
 * Creates rows in the `integration_api_keys` and `zapier_webhook_subscriptions` tables
 * for testing Zapier functionality.
 */
import crypto from "crypto";
import { faker } from "@faker-js/faker";
import { testPool } from "../setup/testDb";
import { createUser, UserRecord } from "./user.factory";

export interface ApiKeyRecord {
  id: string;
  owner_user_id: string | null;
  key_hash: string;
  provider: string;
  scopes: string[];
  is_active: boolean;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
}

export interface WebhookSubscriptionRecord {
  id: string;
  api_key_id: string;
  trigger_name: string;
  target_url: string;
  secret: string | null;
  metadata: string;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKeyOverrides {
  ownerUserId?: string | null;
  scopes?: string[];
  isActive?: boolean;
  expiresAt?: Date | null;
}

export interface WebhookSubscriptionOverrides {
  apiKeyId?: string;
  triggerName?: string;
  targetUrl?: string;
  secret?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createZapierApiKey(
  overrides: ApiKeyOverrides = {},
): Promise<ApiKeyRecord> {
  const {
    ownerUserId = null,
    scopes = ["webhooks:read", "webhooks:write"],
    isActive = true,
    expiresAt = null,
  } = overrides;

  const rawApiKey = `zap_test_${crypto.randomBytes(16).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

  const { rows } = await testPool.query<ApiKeyRecord>(
    `INSERT INTO integration_api_keys
       (owner_user_id, key_hash, provider, scopes, is_active, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [ownerUserId, keyHash, "zapier", scopes, isActive, expiresAt],
  );

  return rows[0];
}

export async function createZapierWebhookSubscription(
  overrides: WebhookSubscriptionOverrides = {},
): Promise<WebhookSubscriptionRecord> {
  const {
    apiKeyId,
    triggerName = "new_booking",
    targetUrl = faker.internet.url(),
    secret = null,
    metadata = {},
  } = overrides;

  // If no apiKeyId provided, create one
  const finalApiKeyId = apiKeyId || (await createZapierApiKey()).id;

  const { rows } = await testPool.query<WebhookSubscriptionRecord>(
    `INSERT INTO zapier_webhook_subscriptions
       (api_key_id, trigger_name, target_url, secret, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [finalApiKeyId, triggerName, targetUrl, secret, JSON.stringify(metadata)],
  );

  return rows[0];
}

export async function createZapierWebhookSubscriptionWithUser(
  userOverrides: Parameters<typeof createUser>[0] = {},
  subscriptionOverrides: WebhookSubscriptionOverrides = {},
): Promise<{ user: UserRecord; apiKey: ApiKeyRecord; subscription: WebhookSubscriptionRecord }> {
  const user = await createUser(userOverrides);
  const apiKey = await createZapierApiKey({ ownerUserId: user.id });
  const subscription = await createZapierWebhookSubscription({
    ...subscriptionOverrides,
    apiKeyId: apiKey.id,
  });

  return { user, apiKey, subscription };
}
