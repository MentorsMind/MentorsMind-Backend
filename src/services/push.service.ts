import * as admin from "firebase-admin";
import { PushTokensModel } from "../models/push-tokens.model";
import { UsersService } from "./users.service";
import { NotificationChannel } from "../models/notifications.model";
import { logger } from "../utils/logger";
import { env } from "../config/env";

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  clickAction?: string;
}

export interface PushSendResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  errors: string[];
}

/**
 * Push Notification Service using Firebase Cloud Messaging
 */
export const PushService = {
  initialized: false,

  /**
   * Initialize Firebase Admin SDK
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      // Check if Firebase credentials are configured
      if (
        !env.FIREBASE_PROJECT_ID ||
        !env.FIREBASE_PRIVATE_KEY ||
        !env.FIREBASE_CLIENT_EMAIL
      ) {
        logger.warn(
          "Firebase credentials not configured. Push notifications will be disabled.",
        );
        return;
      }

      // Initialize Firebase Admin
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
        }),
      });

      this.initialized = true;
      logger.info("Firebase Admin SDK initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Firebase Admin SDK:", error);
    }
  },

  /**
   * Send push notification to a specific user
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<PushSendResult> {
    const result: PushSendResult = {
      success: false,
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      errors: [],
    };

    try {
      // Check if Firebase is initialized
      if (!this.initialized) {
        result.errors.push("Firebase not initialized");
        return result;
      }

      // Check user notification preferences
      const user = await UsersService.findById(userId);
      const preferences = user?.notification_preferences;

      if (preferences) {
        const type = data?.type;
        if (
          type &&
          preferences[type] &&
          preferences[type][NotificationChannel.PUSH] === false
        ) {
          result.errors.push(
            `User has disabled push notifications for type: ${type}`,
          );
          return result;
        }
      }

      // Get all active tokens for the user
      const tokens = await PushTokensModel.getActiveTokensByUserId(userId);

      if (tokens.length === 0) {
        result.errors.push("No active push tokens found for user");
        return result;
      }

      // Prepare notification payload
      const payload: PushNotificationPayload = {
        title,
        body,
        data,
      };

      // Send to all user devices
      const sendResult = await this.sendToTokens(
        tokens.map((t) => t.token),
        payload,
      );

      // Handle invalid tokens
      if (sendResult.invalidTokens.length > 0) {
        await this.handleInvalidTokens(sendResult.invalidTokens);
      }

      // Update last_used_at for successful tokens
      const successfulTokens = tokens
        .map((t) => t.token)
        .filter((token) => !sendResult.invalidTokens.includes(token));

      for (const token of successfulTokens) {
        await PushTokensModel.updateLastUsed(token);
      }

      return sendResult;
    } catch (error) {
      result.errors.push(
        `Failed to send push notification: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return result;
    }
  },

  /**
   * Send push notification to multiple tokens
   */
  async sendToTokens(
    tokens: string[],
    payload: PushNotificationPayload,
  ): Promise<PushSendResult> {
    const result: PushSendResult = {
      success: false,
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      errors: [],
    };

    if (!this.initialized) {
      result.errors.push("Firebase not initialized");
      return result;
    }

    if (tokens.length === 0) {
      result.errors.push("No tokens provided");
      return result;
    }

    try {
      const BATCH_SIZE = 500;
      const baseMessage = {
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data || {},
        webpush: payload.clickAction
          ? { fcmOptions: { link: payload.clickAction } }
          : undefined,
      };

      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE);
        const message: admin.messaging.MulticastMessage = {
          ...baseMessage,
          tokens: batch,
        };
        const response = await admin.messaging().sendEachForMulticast(message);

        result.successCount += response.successCount;
        result.failureCount += response.failureCount;

        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const error = resp.error;
            if (
              error?.code === "messaging/invalid-registration-token" ||
              error?.code === "messaging/registration-token-not-registered"
            ) {
              result.invalidTokens.push(batch[idx]);
            } else {
              result.errors.push(
                `Token ${i + idx}: ${error?.message || "Unknown error"}`,
              );
            }
          }
        });
      }

      result.success = result.failureCount === 0;

      logger.info("Push notification sent", {
        successCount: result.successCount,
        failureCount: result.failureCount,
        invalidTokenCount: result.invalidTokens.length,
      });

      return result;
    } catch (error) {
      result.errors.push(
        `Failed to send push notification: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      logger.error("Push notification error:", error);
      return result;
    }
  },

  /**
   * Handle invalid/expired tokens by marking them inactive
   */
  async handleInvalidTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) {
      return;
    }

    logger.info(`Marking ${tokens.length} invalid tokens as inactive`);

    for (const token of tokens) {
      await PushTokensModel.markTokenInactive(token);
    }
  },

  /**
   * Send session reminder push notification
   */
  async sendSessionReminder(
    userId: string,
    sessionDetails: {
      mentorName: string;
      scheduledAt: Date;
      durationMinutes: number;
      bookingId: string;
    },
  ): Promise<PushSendResult> {
    const title = "Session Starting Soon";
    const body = `Your session with ${sessionDetails.mentorName} starts in 15 minutes`;
    const data = {
      type: "session_reminder",
      bookingId: sessionDetails.bookingId,
      scheduledAt: sessionDetails.scheduledAt.toISOString(),
    };

    return this.sendToUser(userId, title, body, data);
  },

  /**
   * Send payment confirmed push notification
   */
  async sendPaymentConfirmed(
    userId: string,
    paymentDetails: {
      amount: string;
      transactionId: string;
    },
  ): Promise<PushSendResult> {
    const title = "Payment Confirmed";
    const body = `Your payment of ${paymentDetails.amount} XLM has been confirmed`;
    const data = {
      type: "payment_confirmed",
      transactionId: paymentDetails.transactionId,
      amount: paymentDetails.amount,
    };

    return this.sendToUser(userId, title, body, data);
  },

  /**
   * Send new message push notification
   */
  async sendNewMessage(
    userId: string,
    messageDetails: {
      senderName: string;
      messagePreview: string;
      conversationId: string;
    },
  ): Promise<PushSendResult> {
    const title = `New message from ${messageDetails.senderName}`;
    const body = messageDetails.messagePreview;
    const data = {
      type: "new_message",
      conversationId: messageDetails.conversationId,
    };

    return this.sendToUser(userId, title, body, data);
  },

  /**
   * Test push notification (for debugging)
   */
  async sendTestNotification(userId: string): Promise<PushSendResult> {
    return this.sendToUser(
      userId,
      "Test Notification",
      "This is a test push notification from MentorMinds",
      { type: "test" },
    );
  },
};

// Initialize Firebase on module load
PushService.initialize();

export default PushService;
