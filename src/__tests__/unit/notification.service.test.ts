import { enqueueEmail } from "../../queues/email.queue";
import { NotificationAnalyticsModel } from "../../models/notification-analytics.model";
import {
  NotificationDeliveryTrackingModel,
  DeliveryStatus,
  type NotificationDeliveryTrackingRecord,
} from "../../models/notification-delivery-tracking.model";
import { NotificationPreferencesModel } from "../../models/notification-preferences.model";
import type { NotificationPreferencesRecord } from "../../models/notification-preferences.model";
import { NotificationsModel } from "../../models/notifications.model";
import type { NotificationRecord } from "../../models/notifications.model";
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from "../../models/notifications.model";
import { NotificationService } from "../../services/notification.service";
import { PushService } from "../../services/push.service";
import { SocketService } from "../../services/socket.service";

jest.mock("../../models/notifications.model");
jest.mock("../../models/notification-preferences.model");
jest.mock("../../models/notification-delivery-tracking.model");
jest.mock("../../models/notification-analytics.model");
jest.mock("../../services/socket.service");
jest.mock("../../services/push.service");
jest.mock("../../queues/email.queue");

const mockNotificationsModel = NotificationsModel as jest.Mocked<
  typeof NotificationsModel
>;
const mockPreferencesModel = NotificationPreferencesModel as jest.Mocked<
  typeof NotificationPreferencesModel
>;
const mockDeliveryTrackingModel =
  NotificationDeliveryTrackingModel as jest.Mocked<
    typeof NotificationDeliveryTrackingModel
  >;
const mockAnalyticsModel = NotificationAnalyticsModel as jest.Mocked<
  typeof NotificationAnalyticsModel
>;
const mockSocketService = SocketService as jest.Mocked<typeof SocketService>;
const mockPushService = PushService as jest.Mocked<typeof PushService>;
const mockEnqueueEmail = enqueueEmail as jest.MockedFunction<
  typeof enqueueEmail
>;

function prefsRecord(
  overrides: Partial<NotificationPreferencesRecord> = {},
): NotificationPreferencesRecord {
  const now = new Date();
  return {
    id: "pref-1",
    user_id: "user-123",
    email_enabled: true,
    in_app_enabled: true,
    push_enabled: false,
    preferences: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function notifRecord(
  partial: Partial<NotificationRecord> &
    Pick<NotificationRecord, "id" | "user_id">,
): NotificationRecord {
  const now = new Date();
  return {
    type: NotificationType.BOOKING_CONFIRMED,
    channel: NotificationChannel.IN_APP,
    priority: NotificationPriority.NORMAL,
    title: "t",
    message: "m",
    template_data: {},
    data: {},
    is_read: false,
    created_at: now,
    updated_at: now,
    ...partial,
  };
}

function deliveryRecord(
  partial: Partial<NotificationDeliveryTrackingRecord> &
    Pick<
      NotificationDeliveryTrackingRecord,
      "notification_id" | "status" | "channel"
    >,
): NotificationDeliveryTrackingRecord {
  const now = new Date();
  return {
    id: "d1",
    metadata: {},
    created_at: now,
    ...partial,
  };
}

describe("NotificationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sendNotification", () => {
    it("crea notificaciones por canal permitido", async () => {
      const request = {
        userId: "user-123",
        type: NotificationType.BOOKING_CONFIRMED,
        channels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        title: "Booking Confirmed",
        message: "Your booking has been confirmed",
      };

      mockPreferencesModel.getByUserId.mockResolvedValue(
        prefsRecord({ push_enabled: false }),
      );
      mockNotificationsModel.create.mockResolvedValue(
        notifRecord({
          id: "notif-123",
          user_id: request.userId,
          type: request.type,
          channel: NotificationChannel.IN_APP,
          title: request.title,
          message: request.message,
        }),
      );
      mockDeliveryTrackingModel.create.mockResolvedValue(
        deliveryRecord({
          notification_id: "notif-123",
          status: DeliveryStatus.PROCESSING,
          channel: NotificationChannel.IN_APP,
        }),
      );
      mockAnalyticsModel.incrementMetric.mockResolvedValue(undefined);

      const result = await NotificationService.sendNotification(request);

      expect(result.success).toBe(true);
      expect(result.notificationIds.length).toBeGreaterThan(0);
    });

    it("valida preferencias: omite push deshabilitado", async () => {
      const request = {
        userId: "user-123",
        type: NotificationType.BOOKING_CONFIRMED,
        channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        title: "T",
        message: "M",
      };

      mockPreferencesModel.getByUserId.mockResolvedValue(
        prefsRecord({ push_enabled: false }),
      );
      mockNotificationsModel.create.mockResolvedValue(
        notifRecord({
          id: "n1",
          user_id: "user-123",
          channel: NotificationChannel.IN_APP,
          title: "T",
          message: "M",
        }),
      );
      mockDeliveryTrackingModel.create.mockResolvedValue(
        deliveryRecord({
          notification_id: "n1",
          status: DeliveryStatus.PROCESSING,
          channel: NotificationChannel.IN_APP,
        }),
      );
      mockAnalyticsModel.incrementMetric.mockResolvedValue(undefined);

      await NotificationService.sendNotification(request);

      expect(mockNotificationsModel.create).toHaveBeenCalledTimes(1);
    });

    it("registra error si falla creación en un canal", async () => {
      const request = {
        userId: "user-123",
        type: NotificationType.BOOKING_CONFIRMED,
        channels: [NotificationChannel.IN_APP],
        title: "T",
        message: "M",
      };

      mockPreferencesModel.getByUserId.mockResolvedValue(
        prefsRecord({ push_enabled: false }),
      );
      mockNotificationsModel.create.mockRejectedValue(
        new Error("db write failed"),
      );

      const result = await NotificationService.sendNotification(request);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes("db write failed"))).toBe(
        true,
      );
    });
  });

  describe("createNotification", () => {
    it("emite evento socket al crear", async () => {
      const input = {
        user_id: "user-123",
        type: NotificationType.BOOKING_CONFIRMED,
        channel: NotificationChannel.IN_APP,
        priority: NotificationPriority.NORMAL,
        title: "Booking Confirmed",
        message: "Confirmed",
        data: { bookingId: "b1" },
      };

      const mockNotification = notifRecord({
        id: "notif-123",
        user_id: input.user_id,
        type: input.type,
        channel: input.channel,
        title: input.title,
        message: input.message,
        data: input.data ?? {},
      });

      mockNotificationsModel.create.mockResolvedValue(mockNotification);

      const result = await NotificationService.createNotification(input);

      expect(result?.id).toBe("notif-123");
      expect(mockSocketService.emitToUser).toHaveBeenCalledWith(
        "user-123",
        "notification:new",
        expect.objectContaining({ notificationId: "notif-123" }),
      );
    });

    it("envía push cuando el canal es PUSH", async () => {
      const input = {
        user_id: "user-123",
        type: NotificationType.BOOKING_CONFIRMED,
        channel: NotificationChannel.PUSH,
        priority: NotificationPriority.NORMAL,
        title: "T",
        message: "M",
        data: { k: 1 },
      };

      const mockNotification = notifRecord({
        id: "n1",
        user_id: input.user_id,
        type: input.type,
        channel: input.channel,
        title: input.title,
        message: input.message,
        data: { k: "1" },
      });

      mockNotificationsModel.create.mockResolvedValue(mockNotification);
      mockPushService.sendToUser.mockResolvedValue(undefined);

      await NotificationService.createNotification(input);

      expect(mockPushService.sendToUser).toHaveBeenCalled();
    });

    it("no rompe si el socket falla", async () => {
      const input = {
        user_id: "user-123",
        type: NotificationType.BOOKING_CONFIRMED,
        channel: NotificationChannel.IN_APP,
        priority: NotificationPriority.NORMAL,
        title: "T",
        message: "M",
      };

      mockNotificationsModel.create.mockResolvedValue(
        notifRecord({
          id: "n1",
          user_id: input.user_id,
          type: input.type,
          channel: input.channel,
          title: input.title,
          message: input.message,
        }),
      );
      mockSocketService.emitToUser.mockImplementation(() => {
        throw new Error("socket down");
      });

      const result = await NotificationService.createNotification(input);

      expect(result?.id).toBe("n1");
    });
  });

  describe("sendEmail", () => {
    it("encola email correctamente", async () => {
      mockEnqueueEmail.mockResolvedValue(undefined);

      const ok = await NotificationService.sendEmail({
        to: "a@b.com",
        subject: "S",
        body: "text",
        html: "<p>text</p>",
      });

      expect(ok).toBe(true);
      expect(mockEnqueueEmail).toHaveBeenCalledWith({
        to: ["a@b.com"],
        subject: "S",
        htmlContent: "<p>text</p>",
        textContent: "text",
      });
    });

    it("devuelve false si la cola falla", async () => {
      mockEnqueueEmail.mockRejectedValue(new Error("queue unavailable"));

      const ok = await NotificationService.sendEmail({
        to: "a@b.com",
        subject: "S",
        body: "text",
      });

      expect(ok).toBe(false);
    });
  });

  describe("validateNotificationRequest", () => {
    it("acepta petición válida", () => {
      const res = NotificationService.validateNotificationRequest({
        userId: "u1",
        type: NotificationType.BOOKING_CONFIRMED,
        channels: [NotificationChannel.IN_APP],
      });

      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("devuelve errores de validación", () => {
      const res = NotificationService.validateNotificationRequest({
        userId: "",
        type: "not_a_real_type" as NotificationType,
        channels: [],
      });

      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    });
  });

  describe("getNotificationStatus", () => {
    it("devuelve historial de entrega", async () => {
      mockNotificationsModel.getById.mockResolvedValue(
        notifRecord({
          id: "n1",
          user_id: "u1",
        }),
      );
      mockDeliveryTrackingModel.getByNotificationId.mockResolvedValue([]);
      mockDeliveryTrackingModel.getLatestStatus.mockResolvedValue(
        deliveryRecord({
          notification_id: "n1",
          status: DeliveryStatus.DELIVERED,
          channel: NotificationChannel.IN_APP,
        }),
      );

      const status = await NotificationService.getNotificationStatus("n1");

      expect(status?.status).toBe(DeliveryStatus.DELIVERED);
    });

    it("devuelve null si falla el modelo", async () => {
      mockNotificationsModel.getById.mockRejectedValue(new Error("db error"));

      const status = await NotificationService.getNotificationStatus("n1");

      expect(status).toBeNull();
    });
  });

  describe("cleanupExpiredNotifications", () => {
    it("elimina notificaciones expiradas", async () => {
      mockNotificationsModel.deleteExpired.mockResolvedValue(3);

      const n = await NotificationService.cleanupExpiredNotifications();

      expect(n).toBe(3);
    });

    it("devuelve 0 ante error", async () => {
      mockNotificationsModel.deleteExpired.mockRejectedValue(new Error("db"));

      const n = await NotificationService.cleanupExpiredNotifications();

      expect(n).toBe(0);
    });
  });
});
