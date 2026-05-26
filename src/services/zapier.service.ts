import crypto from "crypto";
import pool from "../config/database";
import { MessagingService } from "./messaging.service";
import { GoalService } from "./goal.service";

const TRIGGERS = [
  "new_booking",
  "session_completed",
  "payment_received",
  "new_review",
] as const;

const ACTIONS = [
  "send_message",
  "create_note",
  "update_goal_progress",
] as const;

type TriggerName = (typeof TRIGGERS)[number];
type ActionName = (typeof ACTIONS)[number];

interface ApiKeyRecord {
  id: string;
  owner_user_id: string | null;
  scopes: string[];
  is_active: boolean;
  expires_at: Date | null;
}

export interface ZapierContext {
  apiKeyId: string;
  ownerUserId: string | null;
}

export const ZapierService = {
  listTriggers(): readonly TriggerName[] {
    return TRIGGERS;
  },

  listActions(): readonly ActionName[] {
    return ACTIONS;
  },

  async authenticateApiKey(
    rawApiKey: string | undefined,
  ): Promise<ZapierContext | null> {
    if (!rawApiKey) {
      return null;
    }

    const keyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");
    const { rows } = await pool.query<ApiKeyRecord>(
      `SELECT id, owner_user_id, scopes, is_active, expires_at
         FROM integration_api_keys
        WHERE key_hash = $1
          AND provider = 'zapier'
          AND is_active = TRUE`,
      [keyHash],
    );

    const record = rows[0];
    if (!record) {
      return null;
    }

    if (record.expires_at && record.expires_at <= new Date()) {
      return null;
    }

    await pool.query(
      `UPDATE integration_api_keys SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [record.id],
    );

    return {
      apiKeyId: record.id,
      ownerUserId: record.owner_user_id,
    };
  },

  async subscribe(
    context: ZapierContext,
    trigger: TriggerName,
    targetUrl: string,
    secret?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ id: string; trigger: TriggerName; targetUrl: string }> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO zapier_webhook_subscriptions
         (api_key_id, trigger_name, target_url, secret, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        context.apiKeyId,
        trigger,
        targetUrl,
        secret ?? null,
        JSON.stringify(metadata),
      ],
    );

    return {
      id: rows[0].id,
      trigger,
      targetUrl,
    };
  },

  async unsubscribe(
    context: ZapierContext,
    params: { subscriptionId?: string; targetUrl?: string },
  ): Promise<boolean> {
    const filters: string[] = [`api_key_id = $1`];
    const values: unknown[] = [context.apiKeyId];
    let index = 2;

    if (params.subscriptionId) {
      filters.push(`id = $${index++}`);
      values.push(params.subscriptionId);
    }
    if (params.targetUrl) {
      filters.push(`target_url = $${index++}`);
      values.push(params.targetUrl);
    }

    const { rowCount } = await pool.query(
      `DELETE FROM zapier_webhook_subscriptions WHERE ${filters.join(" AND ")}`,
      values,
    );

    return (rowCount ?? 0) > 0;
  },

  getSamplePayload(trigger: TriggerName): Record<string, unknown> {
    const samples: Record<TriggerName, Record<string, unknown>> = {
      new_booking: {
        id: "booking_sample_123",
        mentorId: "mentor_123",
        menteeId: "mentee_123",
        scheduledStart: new Date().toISOString(),
        amount: "50.00",
        currency: "XLM",
      },
      session_completed: {
        id: "session_sample_123",
        bookingId: "booking_sample_123",
        mentorId: "mentor_123",
        menteeId: "mentee_123",
        completedAt: new Date().toISOString(),
      },
      payment_received: {
        id: "payment_sample_123",
        transactionId: "txn_sample_123",
        userId: "user_123",
        amount: "50.0000000",
        currency: "XLM",
        status: "confirmed",
      },
      new_review: {
        id: "review_sample_123",
        bookingId: "booking_sample_123",
        reviewerId: "user_123",
        revieweeId: "user_456",
        rating: 5,
        body: "Excellent mentoring session.",
      },
    };

    return samples[trigger];
  },

  getSampleActionPayload(action: ActionName): Record<string, unknown> {
    const samples: Record<ActionName, Record<string, unknown>> = {
      send_message: {
        conversationId: "conversation_sample_123",
        body: "Hello! This is a test message from Zapier.",
      },
      create_note: {
        bookingId: "booking_sample_123",
        authorId: "user_123",
        content: "This is a private note about the booking.",
        isPrivate: true,
      },
      update_goal_progress: {
        goalId: "goal_sample_123",
        learnerId: "learner_123",
        progress: 75,
      },
    };

    return samples[action];
  },

  async executeAction(
    action: ActionName,
    payload: Record<string, any>,
    context: ZapierContext,
  ): Promise<Record<string, unknown>> {
    if (action === "send_message") {
      const { rows: keyRows } = await pool.query<{ scopes: string[] }>(
        `SELECT scopes FROM integration_api_keys WHERE id = $1`,
        [context.apiKeyId],
      );
      if (!keyRows[0]?.scopes?.includes("messaging:write")) {
        throw new Error("API key missing required scope: messaging:write");
      }

      if (!context.ownerUserId) {
        throw new Error("API key has no associated owner user");
      }

      const message = await MessagingService.sendMessage(
        payload.conversationId,
        context.ownerUserId,
        String(payload.body ?? ""),
      );
      if (!message) {
        throw new Error("Conversation not found or sender has no access");
      }
      return { messageId: message.id, conversationId: message.conversation_id };
    }

    if (action === "create_note") {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO booking_notes (booking_id, author_id, content, is_private)
         VALUES ($1, $2, $3, COALESCE($4, FALSE))
         RETURNING id`,
        [
          payload.bookingId,
          payload.authorId,
          payload.content,
          payload.isPrivate,
        ],
      );
      return { noteId: rows[0].id };
    }

    if (action === "update_goal_progress") {
      if (!payload.goalId || !payload.learnerId || payload.progress === undefined) {
        throw new Error("Missing required fields: goalId, learnerId, progress");
      }

      const updatedGoal = await GoalService.updateProgress(
        payload.goalId,
        payload.learnerId,
        Number(payload.progress)
      );

      return { updated: true, goal: updatedGoal };
    }

    throw new Error(`Unknown action: ${action}`);
  },
};
