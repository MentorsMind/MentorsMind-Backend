import * as admin from "firebase-admin";
import pool from "../config/database";
import { PushTokensModel, PushTokenRecord } from "../models/push-tokens.model";
import { logger } from "../utils/logger.utils";
import { env } from "../config/env";
import {
  pushTokenInvalidTotal,
  pushNotificationsSentTotal,
} from "../config/metrics";

export interface NotificationAction {
  id: string;
  title: string;
  icon?: string;
}

export interface RichPushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  clickAction?: string;
  deepLink?: string;
  priority?: "high" | "normal";
  actions?: NotificationAction[];
  sound?: string;
  badge?: number;
  channelId?: string;
  category?: string;
  ttlSeconds?: number;
}

export interface UserSegmentFilter {
  role?: "mentor" | "learner" | "admin" | "all";
  tier?: "bronze" | "silver" | "gold" | "platinum";
  deviceType?: "web" | "android" | "ios";
  activeWithinDays?: number;
  inactiveForDays?: number;
  timezone?: string;
  skill?: string;
  userIds?: string[];
}

export interface PushSendResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  errors: string[];
  messageId?: string;
}

export interface DeliveryAnalyticsRecord {
  id: string;
  userId: string;
  token?: string;
  title: string;
  status: "sent" | "delivered" | "opened" | "failed";
  deviceType?: string;
  segment?: string;
  errorMessage?: string;
  sentAt: Date;
  openedAt?: Date;
}

export interface PushAnalyticsSummary {
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalFailed: number;
  deliveryRatePercent: number;
  openRatePercent: number;
  errorBreakdown: Record<string, number>;
  deviceTypeBreakdown: Record<string, number>;
  timeSeries?: Array<{ date: string; sent: number; opened: number; failed: number }>;
}

// In-memory analytics store with fallback / buffer
const analyticsStore: DeliveryAnalyticsRecord[] = [];

/**
 * Mobile Push Notification Service
 * Provides rich notifications, FCM integration, user segmentation, and delivery analytics
 */
export class PushNotificationService {
  private static isInitialized = false;

  /**
   * Initialize Firebase Admin SDK
   */
  static initialize(): void {
    if (admin.apps.length > 0) {
      this.isInitialized = true;
      return;
    }

    try {
      if (
        !env.FIREBASE_PROJECT_ID ||
        !env.FIREBASE_PRIVATE_KEY ||
        !env.FIREBASE_CLIENT_EMAIL
      ) {
        logger.warn("Firebase credentials not fully configured. Running push in simulated/test mode.");
        return;
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
        }),
      });

      this.isInitialized = true;
      logger.info("PushNotificationService: Firebase Admin initialized successfully");
    } catch (error) {
      logger.error("PushNotificationService: Failed to initialize Firebase Admin", { error });
    }
  }

  /**
   * Send rich notification to a single user across their registered devices
   */
  static async sendToUser(
    userId: string,
    payload: RichPushNotificationPayload
  ): Promise<PushSendResult> {
    this.initialize();

    const tokens = await PushTokensModel.getActiveTokensByUserId(userId);
    if (!tokens || tokens.length === 0) {
      logger.debug("No active push tokens found for user", { userId });
      return {
        success: false,
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        errors: ["No active push tokens found for user"],
      };
    }

    return this.sendToTokenRecords(tokens, payload, { userId });
  }

  /**
   * Send rich notification to a list of specific user IDs (multicast)
   */
  static async sendMulticast(
    userIds: string[],
    payload: RichPushNotificationPayload
  ): Promise<PushSendResult> {
    this.initialize();

    if (userIds.length === 0) {
      return {
        success: true,
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        errors: [],
      };
    }

    const { rows } = await pool.query<PushTokenRecord>(
      `SELECT * FROM push_tokens 
       WHERE user_id = ANY($1) AND is_active = TRUE AND is_valid = TRUE`,
      [userIds]
    );

    if (rows.length === 0) {
      return {
        success: false,
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        errors: ["No active tokens for selected user segment"],
      };
    }

    return this.sendToTokenRecords(rows, payload);
  }

  /**
   * Send notification to a targeted user segment
   */
  static async sendToSegment(
    segment: UserSegmentFilter,
    payload: RichPushNotificationPayload
  ): Promise<PushSendResult & { targetUsersCount: number }> {
    this.initialize();

    const userIds = await this.resolveSegmentUserIds(segment);
    if (userIds.length === 0) {
      return {
        success: true,
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        errors: [],
        targetUsersCount: 0,
      };
    }

    const result = await this.sendMulticast(userIds, payload);
    return {
      ...result,
      targetUsersCount: userIds.length,
    };
  }

  /**
   * Resolve user IDs based on segment targeting criteria
   */
  static async resolveSegmentUserIds(filter: UserSegmentFilter): Promise<string[]> {
    if (filter.userIds && filter.userIds.length > 0) {
      return filter.userIds;
    }

    let query = `SELECT DISTINCT u.id FROM users u LEFT JOIN loyalty_accounts la ON u.id = la.user_id WHERE 1=1`;
    const params: any[] = [];
    let pIdx = 1;

    if (filter.role && filter.role !== "all") {
      query += ` AND u.role = $${pIdx++}`;
      params.push(filter.role);
    }

    if (filter.tier) {
      const tierThresholds = { bronze: 0, silver: 100, gold: 500, platinum: 2000 };
      const minPoints = tierThresholds[filter.tier] || 0;
      query += ` AND COALESCE(CAST(la.balance AS NUMERIC), 0) >= $${pIdx++}`;
      params.push(minPoints);
    }

    if (filter.activeWithinDays) {
      query += ` AND u.last_login_at >= NOW() - INTERVAL '${Math.floor(filter.activeWithinDays)} days'`;
    }

    if (filter.inactiveForDays) {
      query += ` AND (u.last_login_at IS NULL OR u.last_login_at < NOW() - INTERVAL '${Math.floor(filter.inactiveForDays)} days')`;
    }

    if (filter.timezone) {
      query += ` AND u.timezone = $${pIdx++}`;
      params.push(filter.timezone);
    }

    try {
      const { rows } = await pool.query(query, params);
      return rows.map((r: any) => r.id);
    } catch (error) {
      logger.error("Failed to query segment user IDs", { filter, error });
      return [];
    }
  }

  /**
   * Send notification to a specific list of token records
   */
  private static async sendToTokenRecords(
    tokens: PushTokenRecord[],
    payload: RichPushNotificationPayload,
    context?: { userId?: string; segment?: string }
  ): Promise<PushSendResult> {
    const result: PushSendResult = {
      success: false,
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      errors: [],
    };

    if (tokens.length === 0) return result;

    const dataPayload: Record<string, string> = {
      ...(payload.data || {}),
      title: payload.title,
      body: payload.body,
    };

    if (payload.deepLink) {
      dataPayload.deepLink = payload.deepLink;
    }
    if (payload.clickAction) {
      dataPayload.clickAction = payload.clickAction;
    }
    if (payload.actions && payload.actions.length > 0) {
      dataPayload.actions = JSON.stringify(payload.actions);
    }

    // Process each token or batch
    for (const tokenRecord of tokens) {
      const token = tokenRecord.token;

      // If Firebase Admin app is available and real credentials exist
      if (admin.apps.length > 0) {
        try {
          const message: admin.messaging.Message = {
            token,
            notification: {
              title: payload.title,
              body: payload.body,
              imageUrl: payload.imageUrl,
            },
            data: dataPayload,
            android: {
              priority: payload.priority === "high" ? "high" : "normal",
              notification: {
                sound: payload.sound || "default",
                channelId: payload.channelId || "default_channel",
                clickAction: payload.clickAction,
                imageUrl: payload.imageUrl,
              },
              ttl: (payload.ttlSeconds || 3600) * 1000,
            },
            apns: {
              payload: {
                aps: {
                  sound: payload.sound || "default",
                  badge: payload.badge,
                  category: payload.category,
                },
              },
            },
          };

          const fcmResponse = await admin.messaging().send(message);
          result.successCount++;
          result.messageId = fcmResponse;
          await PushTokensModel.updateLastUsed(token);

          this.recordAnalytics({
            id: `del_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            userId: tokenRecord.user_id,
            token,
            title: payload.title,
            status: "sent",
            deviceType: tokenRecord.device_type,
            segment: context?.segment,
            sentAt: new Date(),
          });

          pushNotificationsSentTotal?.inc?.({ channel: "push", status: "success" });
        } catch (fcmError: any) {
          result.failureCount++;
          const errorMsg = fcmError?.message || String(fcmError);
          result.errors.push(errorMsg);

          const errorCode = fcmError?.code || "";
          if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered"
          ) {
            result.invalidTokens.push(token);
            await PushTokensModel.deleteByToken(token);
            pushTokenInvalidTotal?.inc?.();
          }

          this.recordAnalytics({
            id: `del_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            userId: tokenRecord.user_id,
            token,
            title: payload.title,
            status: "failed",
            deviceType: tokenRecord.device_type,
            segment: context?.segment,
            errorMessage: errorMsg,
            sentAt: new Date(),
          });

          pushNotificationsSentTotal?.inc?.({ channel: "push", status: "failure" });
        }
      } else {
        // Simulated / sandbox delivery
        result.successCount++;
        await PushTokensModel.updateLastUsed(token);

        this.recordAnalytics({
          id: `del_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          userId: tokenRecord.user_id,
          token,
          title: payload.title,
          status: "sent",
          deviceType: tokenRecord.device_type,
          segment: context?.segment,
          sentAt: new Date(),
        });
      }
    }

    result.success = result.successCount > 0;
    return result;
  }

  /**
   * Track notification delivery interaction (e.g. user clicked / opened notification)
   */
  static recordNotificationOpened(notificationId: string, userId: string): void {
    const record = analyticsStore.find(
      (a) => a.id === notificationId || (a.userId === userId && a.status === "sent")
    );
    if (record) {
      record.status = "opened";
      record.openedAt = new Date();
    } else {
      analyticsStore.push({
        id: notificationId,
        userId,
        title: "Push Notification",
        status: "opened",
        sentAt: new Date(Date.now() - 60000),
        openedAt: new Date(),
      });
    }
  }

  /**
   * Record analytics internally
   */
  private static recordAnalytics(record: DeliveryAnalyticsRecord): void {
    analyticsStore.push(record);
    // Keep in-memory buffer bounded to last 5000 records
    if (analyticsStore.length > 5000) {
      analyticsStore.shift();
    }
  }

  /**
   * Get push notification delivery and open rate analytics
   */
  static getAnalytics(options?: {
    startDate?: Date;
    endDate?: Date;
    segment?: string;
  }): PushAnalyticsSummary {
    let records = analyticsStore;

    if (options?.startDate) {
      records = records.filter((r) => r.sentAt >= options.startDate!);
    }
    if (options?.endDate) {
      records = records.filter((r) => r.sentAt <= options.endDate!);
    }
    if (options?.segment) {
      records = records.filter((r) => r.segment === options.segment);
    }

    const totalSent = records.filter((r) => r.status === "sent" || r.status === "delivered" || r.status === "opened").length;
    const totalDelivered = records.filter((r) => r.status === "delivered" || r.status === "opened" || r.status === "sent").length;
    const totalOpened = records.filter((r) => r.status === "opened").length;
    const totalFailed = records.filter((r) => r.status === "failed").length;

    const totalAttempts = totalSent + totalFailed;
    const deliveryRatePercent = totalAttempts > 0 ? parseFloat(((totalDelivered / totalAttempts) * 100).toFixed(2)) : 100;
    const openRatePercent = totalDelivered > 0 ? parseFloat(((totalOpened / totalDelivered) * 100).toFixed(2)) : 0;

    const errorBreakdown: Record<string, number> = {};
    const deviceTypeBreakdown: Record<string, number> = {};

    for (const r of records) {
      if (r.errorMessage) {
        errorBreakdown[r.errorMessage] = (errorBreakdown[r.errorMessage] || 0) + 1;
      }
      if (r.deviceType) {
        deviceTypeBreakdown[r.deviceType] = (deviceTypeBreakdown[r.deviceType] || 0) + 1;
      }
    }

    return {
      totalSent,
      totalDelivered,
      totalOpened,
      totalFailed,
      deliveryRatePercent,
      openRatePercent,
      errorBreakdown,
      deviceTypeBreakdown,
    };
  }
}

export default PushNotificationService;
