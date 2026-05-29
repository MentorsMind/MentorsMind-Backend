import { NotificationService } from '../../services/notification.service';
import { NotificationsModel } from '../../models/notifications.model';
import { UsersService } from '../../services/users.service';
import { NotificationDeliveryTrackingModel } from '../../models/notification-delivery-tracking.model';
import { NotificationAnalyticsModel } from '../../models/notification-analytics.model';
import { SocketService } from '../../services/socket.service';
import { PushService } from '../../services/push.service';
import { enqueueEmail } from '../../queues/email.queue';
import { mockDeep, mockReset } from 'jest-mock-extended';

// Mock external dependencies
jest.mock('../../models/notifications.model');
jest.mock('../../services/users.service');
jest.mock('../../models/notification-delivery-tracking.model');
jest.mock('../../models/notification-analytics.model');
jest.mock('../../services/socket.service');
jest.mock('../../services/push.service');
jest.mock('../../queues/email.queue');

const mockNotificationsModel = NotificationsModel as jest.Mocked<typeof NotificationsModel>;
const mockUsersService = UsersService as jest.Mocked<typeof UsersService>;
const mockDeliveryTrackingModel = NotificationDeliveryTrackingModel as jest.Mocked<typeof NotificationDeliveryTrackingModel>;
const mockAnalyticsModel = NotificationAnalyticsModel as jest.Mocked<typeof NotificationAnalyticsModel>;
jest.mock("../../models/notifications.model");
jest.mock("../../models/notification-preferences.model");
jest.mock("../../models/notification-delivery-tracking.model");
jest.mock("../../models/notification-analytics.model");
jest.mock("../../services/socket.service");
jest.mock("../../services/push.service", () => ({
  __esModule: true,
  default: {
    sendToUser: jest.fn(),
    initialize: jest.fn(),
    initialized: false,
  },
  PushService: {
    sendToUser: jest.fn(),
    initialize: jest.fn(),
    initialized: false,
  },
}));
jest.mock("../../queues/email.queue");

import { NotificationService } from "../../services/notification.service";
import { NotificationsModel } from "../../models/notifications.model";
import { NotificationPreferencesModel } from "../../models/notification-preferences.model";
import { NotificationDeliveryTrackingModel } from "../../models/notification-delivery-tracking.model";
import { NotificationAnalyticsModel } from "../../models/notification-analytics.model";
import { SocketService } from "../../services/socket.service";
import { PushService } from "../../services/push.service";
import { enqueueEmail } from "../../queues/email.queue";

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

describe("NotificationService", () => {
  beforeEach(() => {
    mockReset(mockNotificationsModel);
    mockReset(mockUsersService);
    mockReset(mockDeliveryTrackingModel);
    mockReset(mockAnalyticsModel);
    mockReset(mockSocketService);
    mockReset(mockPushService);
    mockReset(mockEnqueueEmail);
    jest.clearAllMocks();
  });

  describe("sendNotification", () => {
    it("should send notification successfully", async () => {
      const request = {
        userId: "user-123",
        type: "booking_confirmed" as any,
        channels: ["in_app" as any, "email" as any],
        title: "Booking Confirmed",
        message: "Your booking has been confirmed",
      };

      const mockUser = {
        id: 'user-123',
        notification_preferences: {
          booking_confirmed: { email: true, push: false, in_app: true },
        },
      };

      const mockNotification = {
        id: "notif-123",
        user_id: request.userId,
        type: request.type,
        channel: "in_app",
        title: request.title,
        message: request.message,
      };

      mockUsersService.findById.mockResolvedValue(mockUser as any);
      mockNotificationsModel.create.mockResolvedValue(mockNotification as any);
      mockDeliveryTrackingModel.create.mockResolvedValue({} as any);
      mockAnalyticsModel.incrementMetric.mockResolvedValue();

      const result = await NotificationService.sendNotification(request);

      expect(result.success).toBe(true);
      expect(result.notificationIds).toContain("notif-123");
      expect(mockSocketService.emitToUser).toHaveBeenCalled();
    });

    it("should filter channels based on preferences", async () => {
      const request = {
        userId: "user-123",
        type: "booking_confirmed" as any,
        channels: ["in_app" as any, "email" as any, "push" as any],
        title: "Booking Confirmed",
        message: "Your booking has been confirmed",
      };

      const mockUser = {
        id: 'user-123',
        notification_preferences: {
          booking_confirmed: { email: true, push: false, in_app: true },
        },
      };

      mockUsersService.findById.mockResolvedValue(mockUser as any);
      mockNotificationsModel.create.mockResolvedValue({
        id: "notif-123",
        user_id: request.userId,
      } as any);
      mockDeliveryTrackingModel.create.mockResolvedValue({} as any);
      mockAnalyticsModel.incrementMetric.mockResolvedValue();

      const result = await NotificationService.sendNotification(request);

      expect(result.success).toBe(true);
      // Should only create notifications for enabled channels
      expect(mockNotificationsModel.create).toHaveBeenCalledTimes(2); // in_app and email
    });
  });

  describe("createNotification", () => {
    it("should create notification and emit socket event", async () => {
      const input = {
        user_id: "user-123",
        type: "booking_confirmed",
        channel: "in_app" as any,
        priority: "normal" as any,
        title: "Booking Confirmed",
        message: "Your booking has been confirmed",
        data: { bookingId: "booking-123" },
      };

      const mockNotification = {
        id: "notif-123",
        ...input,
        created_at: new Date(),
      };

      mockNotificationsModel.create.mockResolvedValue(mockNotification as any);
      mockSocketService.emitToUser.mockResolvedValue();

      const result = await NotificationService.createNotification(input);

      expect(result).toEqual(mockNotification);
      expect(mockSocketService.emitToUser).toHaveBeenCalledWith(
        "user-123",
        "notification:new",
        expect.objectContaining({
          notificationId: "notif-123",
          type: "booking_confirmed",
          title: "Booking Confirmed",
        }),
      );
    });

    it("should send push notification for push channel", async () => {
      const input = {
        user_id: "user-123",
        type: "booking_confirmed",
        channel: "push" as any,
        priority: "normal" as any,
        title: "Booking Confirmed",
        message: "Your booking has been confirmed",
        data: { bookingId: "booking-123" },
      };

      const mockNotification = {
        id: "notif-123",
        ...input,
        created_at: new Date(),
      };

      mockNotificationsModel.create.mockResolvedValue(mockNotification as any);
      mockSocketService.emitToUser.mockResolvedValue();
      mockPushService.sendToUser.mockResolvedValue();

      const result = await NotificationService.createNotification(input);

      expect(result).toEqual(mockNotification);
      expect(mockPushService.sendToUser).toHaveBeenCalledWith(
        "user-123",
        "Booking Confirmed",
        "Your booking has been confirmed",
        { bookingId: "booking-123" },
      );
    });
  });

  describe("create", () => {
    it("should create notification using simplified parameters", async () => {
      const userId = "user-123";
      const type = "session_booked";
      const payload = {
        title: "Session Booked",
        message: "Your session has been booked",
        data: { sessionId: "session-123" },
      };

      const mockNotification = {
        id: "notif-123",
        user_id: userId,
        type,
        channel: "in_app",
        title: payload.title,
        message: payload.message,
        data: payload.data,
      };

      jest
        .spyOn(NotificationService, "createNotification")
        .mockResolvedValue(mockNotification as any);

      const result = await NotificationService.create(userId, type, payload);

      expect(result).toEqual(mockNotification);
      expect(NotificationService.createNotification).toHaveBeenCalledWith({
        user_id: userId,
        type,
        channel: "in_app",
        priority: "normal",
        title: payload.title,
        message: payload.message,
        data: payload.data,
      });
    });
  });

  describe("sendEmail", () => {
    it("should send email successfully", async () => {
      const notification = {
        to: "test@example.com",
        subject: "Test Subject",
        body: "Test body",
        html: "<p>Test body</p>",
      };

      mockEnqueueEmail.mockResolvedValue();

      const result = await NotificationService.sendEmail(notification);

      expect(result).toBe(true);
      expect(mockEnqueueEmail).toHaveBeenCalledWith({
        to: [notification.to],
        subject: notification.subject,
        htmlContent: notification.html,
        textContent: notification.body,
      });
    });

    it("should return false on email failure", async () => {
      const notification = {
        to: "test@example.com",
        subject: "Test Subject",
        body: "Test body",
      };

      mockEnqueueEmail.mockRejectedValue(new Error("Email failed"));

      const result = await NotificationService.sendEmail(notification);

      expect(result).toBe(false);
    });
  });

  describe("sendMeetingUrlNotification", () => {
    it("should send meeting URL notifications to both participants", async () => {
      const params = {
        mentorId: "mentor-123",
        menteeId: "mentee-123",
        mentorEmail: "mentor@example.com",
        menteeEmail: "mentee@example.com",
        mentorName: "John Mentor",
        menteeName: "Jane Mentee",
        meetingUrl: "https://meet.example.com/room123",
        scheduledAt: new Date("2023-01-15T10:00:00Z"),
        durationMinutes: 60,
        expiresAt: new Date("2023-01-15T11:00:00Z"),
      };

      jest.spyOn(NotificationService, "sendEmail").mockResolvedValue(true);
      jest
        .spyOn(NotificationService, "createInAppNotification")
        .mockResolvedValue({} as any);

      await NotificationService.sendMeetingUrlNotification(
        params.mentorId,
        params.menteeId,
        params.mentorEmail,
        params.menteeEmail,
        params.mentorName,
        params.menteeName,
        params.meetingUrl,
        params.scheduledAt,
        params.durationMinutes,
        params.expiresAt,
      );

      expect(NotificationService.sendEmail).toHaveBeenCalledTimes(2);
      expect(NotificationService.createInAppNotification).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe("getUserPreferences", () => {
    it("should return user preferences if they exist", async () => {
      const userId = "user-123";
      const mockPreferences = {
        booking_confirmed: { email: true, push: false, in_app: true },
      };
      const mockUser = { id: userId, notification_preferences: mockPreferences };

      mockUsersService.findById.mockResolvedValue(mockUser as any);

      const result = await NotificationService.getUserPreferences(userId);

      expect(result).toEqual(mockPreferences);
    });

    it('should return default preferences if user or preferences not found', async () => {
      const userId = 'user-123';
      const mockDefaults = NotificationService.getDefaultPreferences();
    it("should return default preferences if user has none", async () => {
      const userId = "user-123";
      const mockDefaults = {
        email_enabled: true,
        in_app_enabled: true,
        push_enabled: true,
      };

      mockUsersService.findById.mockResolvedValue(null);

      const result = await NotificationService.getUserPreferences(userId);

      expect(result).toEqual(mockDefaults);
    });
  });

  describe('filterChannelsByPreferences', () => {
    it('should filter channels based on type-specific preferences', () => {
      const requestedChannels = ['in_app' as any, 'email' as any, 'push' as any];
  describe("filterChannelsByPreferences", () => {
    it("should filter channels based on global preferences", () => {
      const requestedChannels = [
        "in_app" as any,
        "email" as any,
        "push" as any,
      ];
      const preferences = {
        email_enabled: true,
        in_app_enabled: true,
        push_enabled: false,
      };
      const notificationType = "booking_confirmed";

      const result = NotificationService.filterChannelsByPreferences(
        requestedChannels,
        preferences,
        notificationType,
      );

      expect(result).toEqual(["in_app", "email"]);
    });

    it("should filter channels based on type-specific preferences", () => {
      const requestedChannels = ["in_app" as any, "email" as any];
      const preferences = {
        booking_confirmed: {
          email: true,
          in_app: true,
          push: false,
        },
      };
      const notificationType = "booking_confirmed";

      const result = NotificationService.filterChannelsByPreferences(
        requestedChannels,
        preferences,
        notificationType,
      );

      expect(result).toEqual(['in_app', 'email']);
      expect(result).toEqual(["in_app"]);
    });
  });

  describe("getDefaultTitle", () => {
    it("should return default title for known types", () => {
      expect(NotificationService.getDefaultTitle("booking_confirmed")).toBe(
        "Booking Confirmed",
      );
      expect(NotificationService.getDefaultTitle("payment_processed")).toBe(
        "Payment Processed",
      );
      expect(NotificationService.getDefaultTitle("unknown")).toBe(
        "Notification",
      );
    });
  });

  describe("getDefaultMessage", () => {
    it("should return default message for known types", () => {
      expect(NotificationService.getDefaultMessage("booking_confirmed")).toBe(
        "Your booking has been confirmed.",
      );
      expect(NotificationService.getDefaultMessage("payment_processed")).toBe(
        "Your payment has been processed successfully.",
      );
      expect(NotificationService.getDefaultMessage("unknown")).toBe(
        "You have a new notification.",
      );
    });
  });

  describe("getNotificationStatus", () => {
    it("should return notification status with delivery history", async () => {
      const notificationId = "notif-123";

      const mockNotification = {
        id: notificationId,
        channel: "in_app",
        created_at: new Date(),
      };

      const mockDeliveryHistory = [
        { status: "sent", created_at: new Date() },
        { status: "delivered", created_at: new Date() },
      ];

      const mockLatestStatus = { status: "delivered" };

      mockNotificationsModel.getById.mockResolvedValue(mockNotification as any);
      mockDeliveryTrackingModel.getByNotificationId.mockResolvedValue(
        mockDeliveryHistory,
      );
      mockDeliveryTrackingModel.getLatestStatus.mockResolvedValue(
        mockLatestStatus as any,
      );

      const result =
        await NotificationService.getNotificationStatus(notificationId);

      expect(result).toEqual({
        id: notificationId,
        status: "delivered",
        channel: "in_app",
        createdAt: mockNotification.created_at,
        deliveryHistory: mockDeliveryHistory,
      });
    });

    it("should return null if notification not found", async () => {
      const notificationId = "nonexistent";

      mockNotificationsModel.getById.mockResolvedValue(null);

      const result =
        await NotificationService.getNotificationStatus(notificationId);

      expect(result).toBeNull();
    });
  });

  describe("scheduleNotification", () => {
    it("should schedule notification for future delivery", async () => {
      const request = {
        userId: "user-123",
        type: "session_reminder" as any,
        channels: ["in_app" as any],
        title: "Session Reminder",
        message: "Your session starts soon",
        scheduledAt: new Date(Date.now() + 3600000), // 1 hour from now
      };

      const mockResult = {
        success: true,
        notificationIds: ["notif-123"],
        errors: [],
      };

      jest
        .spyOn(NotificationService, "sendNotification")
        .mockResolvedValue(mockResult);

      const result = await NotificationService.scheduleNotification(request);

      expect(result).toBe("notif-123");
      expect(NotificationService.sendNotification).toHaveBeenCalledWith(
        request,
      );
    });
  });

  describe("cancelScheduledNotification", () => {
    it("should cancel scheduled notification", async () => {
      const notificationId = "notif-123";

      mockNotificationsModel.delete.mockResolvedValue(true);

      const result =
        await NotificationService.cancelScheduledNotification(notificationId);

      expect(result).toBe(true);
      expect(mockNotificationsModel.delete).toHaveBeenCalledWith(
        notificationId,
      );
    });
  });

  describe("retryFailedNotification", () => {
    it("should retry failed notification", async () => {
      const notificationId = "notif-123";

      const mockNotification = {
        id: notificationId,
        type: "booking_confirmed",
        channel: "email",
      };

      mockNotificationsModel.getById.mockResolvedValue(mockNotification as any);
      mockDeliveryTrackingModel.create.mockResolvedValue({} as any);
      mockAnalyticsModel.incrementMetric.mockResolvedValue();

      const result =
        await NotificationService.retryFailedNotification(notificationId);

      expect(result).toBe(true);
      expect(mockDeliveryTrackingModel.create).toHaveBeenCalledWith({
        notification_id: notificationId,
        status: "processing",
        channel: "email",
      });
    });
  });

  describe("getUnreadNotifications", () => {
    it("should return unread notifications for user", async () => {
      const userId = "user-123";
      const mockNotifications = [
        { id: "notif-1", is_read: false },
        { id: "notif-2", is_read: false },
      ];

      mockNotificationsModel.getUnreadByUserId.mockResolvedValue(
        mockNotifications as any,
      );

      const result = await NotificationService.getUnreadNotifications(userId);

      expect(result).toEqual(mockNotifications);
    });
  });

  describe("markAsRead", () => {
    it("should mark notification as read", async () => {
      const notificationId = "notif-123";

      mockNotificationsModel.markAsRead.mockResolvedValue(true);

      const result = await NotificationService.markAsRead(notificationId);

      expect(result).toBe(true);
      expect(mockNotificationsModel.markAsRead).toHaveBeenCalledWith(
        notificationId,
      );
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all notifications as read for user", async () => {
      const userId = "user-123";

      mockNotificationsModel.markAllAsReadByUserId.mockResolvedValue(5);

      const result = await NotificationService.markAllAsRead(userId);

      expect(result).toBe(5);
      expect(mockNotificationsModel.markAllAsReadByUserId).toHaveBeenCalledWith(
        userId,
      );
    });
  });

  describe("getUserNotifications", () => {
    it("should return user notifications with filters", async () => {
      const userId = "user-123";
      const options = {
        channel: "in_app",
        isRead: false,
        limit: 10,
        offset: 0,
      };

      const mockNotifications = [
        { id: "notif-1", channel: "in_app", is_read: false },
      ];

      mockNotificationsModel.getByUserId.mockResolvedValue(
        mockNotifications as any,
      );

      const result = await NotificationService.getUserNotifications(
        userId,
        options,
      );

      expect(result).toEqual(mockNotifications);
      expect(mockNotificationsModel.getByUserId).toHaveBeenCalledWith(
        userId,
        options,
      );
    });
  });

  describe("getNotificationCounts", () => {
    it("should return notification counts for user", async () => {
      const userId = "user-123";
      const mockCounts = {
        total: 10,
        unread: 3,
        read: 7,
      };

      mockNotificationsModel.getCountsByUserId.mockResolvedValue(mockCounts);

      const result = await NotificationService.getNotificationCounts(userId);

      expect(result).toEqual(mockCounts);
    });
  });

  describe("validateNotificationRequest", () => {
    it("should validate valid request", () => {
      const request = {
        userId: "user-123",
        type: "booking_confirmed" as any,
        channels: ["in_app" as any],
        title: "Test",
        message: "Test message",
      };

      const result = NotificationService.validateNotificationRequest(request);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return errors for invalid request", () => {
      const request = {
        userId: "",
        type: "invalid_type" as any,
        channels: [],
      };

      const result = NotificationService.validateNotificationRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("userId is required");
      expect(result.errors).toContain("At least one channel is required");
      expect(result.errors).toContain(
        "Invalid notification type: invalid_type",
      );
    });
  });

  describe("cleanupExpiredNotifications", () => {
    it("should cleanup expired notifications", async () => {
      mockNotificationsModel.deleteExpired.mockResolvedValue(5);

      const result = await NotificationService.cleanupExpiredNotifications();

      expect(result).toBe(5);
    });

    it("should return 0 on error", async () => {
      mockNotificationsModel.deleteExpired.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await NotificationService.cleanupExpiredNotifications();

      expect(result).toBe(0);
    });
  });
});
