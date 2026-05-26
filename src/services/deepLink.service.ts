import { env } from "../config/env";
import { AuditLoggerService } from "./audit-logger.service";
import { LogLevel, AuditAction } from "../utils/log-formatter.utils";
import { NotificationType } from "../models/notifications.model";

export enum DeepLinkType {
  SESSION = "session",
  PAYMENT = "payment",
  MESSAGE = "message",
}

export interface DeepLinkParams {
  type: DeepLinkType;
  id: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export const DeepLinkService = {
  /**
   * Generates a deep link URL for the mobile app.
   */
  generateDeepLink(params: DeepLinkParams): string {
    const { type, id } = params;
    return `${env.DEEP_LINK_SCHEME}://${type}/${id}`;
  },

  /**
   * Generates a universal link (HTTP redirect) that handles web fallback.
   */
  generateUniversalLink(params: DeepLinkParams): string {
    const { type, id } = params;
    const baseUrl = env.APP_BASE_URL;
    return `${baseUrl}/api/v1/dl/${type}/${id}`;
  },

  /**
   * Generates a deep link for a specific entity.
   */
  forSession(id: string): string {
    return this.generateUniversalLink({ type: DeepLinkType.SESSION, id });
  },

  forPayment(id: string): string {
    return this.generateUniversalLink({ type: DeepLinkType.PAYMENT, id });
  },

  forMessage(id: string): string {
    return this.generateUniversalLink({ type: DeepLinkType.MESSAGE, id });
  },

  /**
   * Generates an action URL based on notification type and data.
   */
  generateActionUrlForType(
    type: NotificationType,
    data: Record<string, any> = {},
  ): string | null {
    switch (type) {
      case NotificationType.BOOKING_CONFIRMED:
      case NotificationType.SESSION_REMINDER:
      case NotificationType.SESSION_CANCELLED:
      case NotificationType.MEETING_CONFIRMED:
        if (data.bookingId || data.id) {
          return this.forSession(data.bookingId || data.id);
        }
        break;
      case NotificationType.PAYMENT_PROCESSED:
        if (data.transactionId || data.id) {
          return this.forPayment(data.transactionId || data.id);
        }
        break;
      case NotificationType.MESSAGE_RECEIVED:
        if (data.conversationId || data.id) {
          return this.forMessage(data.conversationId || data.id);
        }
        break;
    }
    return null;
  },

  /**
   * Tracks deep link usage.
   */
  async trackUsage(
    params: DeepLinkParams,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<void> {
    await AuditLoggerService.logEvent({
      level: LogLevel.INFO,
      action: AuditAction.DEEP_LINK_ACCESSED,
      message: `Deep link accessed: ${params.type}/${params.id}`,
      userId: params.userId,
      entityType: "DEEP_LINK",
      entityId: `${params.type}/${params.id}`,
      metadata: {
        ...params.metadata,
        type: params.type,
        id: params.id,
        userAgent,
      },
      ipAddress,
      userAgent,
    });
  },

  /**
   * Gets the redirection HTML for a deep link with web fallback.
   */
  getRedirectionHtml(params: DeepLinkParams): string {
    const deepLink = this.generateDeepLink(params);
    let fallbackUrl = env.FRONTEND_URL;

    // Specific fallbacks
    switch (params.type) {
      case DeepLinkType.SESSION:
        fallbackUrl = `${env.FRONTEND_URL}/sessions/${params.id}`;
        break;
      case DeepLinkType.PAYMENT:
        fallbackUrl = `${env.FRONTEND_URL}/payments/${params.id}`;
        break;
      case DeepLinkType.MESSAGE:
        fallbackUrl = `${env.FRONTEND_URL}/messages/${params.id}`;
        break;
    }

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting...</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script>
            window.onload = function() {
              var userAgent = navigator.userAgent || navigator.vendor || window.opera;
              var isIos = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;
              var isAndroid = /android/i.test(userAgent);

              // Attempt to open deep link
              window.location.href = "${deepLink}";

              // Fallback to store or web after a delay
              setTimeout(function() {
                if (isIos && "${env.IOS_APP_STORE_URL || ""}") {
                  window.location.href = "${env.IOS_APP_STORE_URL}";
                } else if (isAndroid && "${env.ANDROID_PLAY_STORE_URL || ""}") {
                  window.location.href = "${env.ANDROID_PLAY_STORE_URL}";
                } else {
                  window.location.href = "${fallbackUrl}";
                }
              }, 2500);
            };
          </script>
        </head>
        <body>
          <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h2>Opening MentorMinds...</h2>
            <p>If you are not redirected, <a href="${fallbackUrl}">click here</a>.</p>
          </div>
        </body>
      </html>
    `;
  },
};
