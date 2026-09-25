import {
  NotificationChannel,
  NotificationService,
} from "../notification.service";
import { UsersService } from "../users.service";
import { NotificationsModel } from "../../models/notifications.model";
import { NotificationType } from "../../models/notifications.model";
import { NotificationDeliveryTrackingModel } from "../../models/notification-delivery-tracking.model";
import { NotificationAnalyticsModel } from "../../models/notification-analytics.model";
import { PushService } from "../push.service";
import { enqueueEmail } from "../../queues/email.queue";

jest.mock("../users.service", () => ({
  UsersService: {
    findById: jest.fn(),
  },
}));

jest.mock("../../models/notifications.model", () => ({
  NotificationsModel: {
    create: jest.fn(),
  },
  NotificationType: {
    BOOKING_CONFIRMED: "booking_confirmed",
    PAYMENT_PROCESSED: "payment_processed",
    SESSION_REMINDER: "session_reminder",
    GOAL_DEADLINE_REMINDER: "goal_deadline_reminder",
    GOAL_OVERDUE: "goal_overdue",
    DISPUTE_CREATED: "dispute_created",
    SYSTEM_ALERT: "system_alert",
    MEETING_CONFIRMED: "meeting_confirmed",
    MESSAGE_RECEIVED: "message_received",
    SESSION_CANCELLED: "session_cancelled",
    CALENDAR_CONNECTION_EXPIRED: "calendar_connection_expired",
  },
}));

jest.mock("../../models/notification-delivery-tracking.model", () => ({
  NotificationDeliveryTrackingModel: {
    create: jest.fn(),
  },
  DeliveryStatus: {
    QUEUED: "queued",
    PROCESSING: "processing",
  },
}));

jest.mock("../../models/notification-analytics.model", () => ({
  NotificationAnalyticsModel: {
    incrementMetric: jest.fn(),
  },
}));

jest.mock("../push.service", () => ({
  PushService: {
    sendToUser: jest.fn(),
  },
}));

jest.mock("../../queues/email.queue", () => ({
  enqueueEmail: jest.fn(),
}));

jest.mock("../deepLink.service", () => ({
  DeepLinkService: {
    generateActionUrlForType: jest.fn(() => undefined),
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    error: jest.fn(),
  },
}));

const findById = UsersService.findById as jest.Mock;
const createNotification = NotificationsModel.create as jest.Mock;
const createDeliveryTracking = NotificationDeliveryTrackingModel.create as jest.Mock;
const incrementMetric = NotificationAnalyticsModel.incrementMetric as jest.Mock;
const sendToUser = PushService.sendToUser as jest.Mock;
const enqueueEmailMock = enqueueEmail as jest.Mock;

const notificationType = NotificationType.BOOKING_CONFIRMED;
const allChannels = [
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
  NotificationChannel.IN_APP,
];

const notificationRecord = {
  id: "notification-1",
  user_id: "user-1",
  type: notificationType,
  title: "Booking Confirmed",
  message: "Your booking has been confirmed.",
  data: {},
  action_url: null,
  is_read: false,
  dismissed_at: null,
  expires_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

describe("NotificationService preference filtering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findById.mockResolvedValue({
      notification_preferences: {
        [notificationType]: { email: true, push: true, in_app: true },
      },
    });
    createNotification.mockResolvedValue(notificationRecord);
    createDeliveryTracking.mockResolvedValue({});
    incrementMetric.mockResolvedValue(undefined);
    sendToUser.mockResolvedValue({ success: true });
    enqueueEmailMock.mockResolvedValue(undefined);
  });

  it("does not enqueue an email when email notifications are disabled", async () => {
    findById.mockResolvedValue({
      notification_preferences: {
        [notificationType]: { email: false, push: true, in_app: true },
      },
    });

    await NotificationService.sendNotification({
      userId: "user-1",
      type: notificationType,
      channels: allChannels,
    });

    expect(enqueueEmailMock).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledTimes(2);
  });

  it("creates no notification when all channels are disabled", async () => {
    findById.mockResolvedValue({
      notification_preferences: {
        [notificationType]: { email: false, push: false, in_app: false },
      },
    });

    await NotificationService.sendNotification({
      userId: "user-1",
      type: notificationType,
      channels: allChannels,
    });

    expect(createNotification).not.toHaveBeenCalled();
    expect(enqueueEmailMock).not.toHaveBeenCalled();
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it("allows and sends only push notifications when push is enabled alone", async () => {
    findById.mockResolvedValue({
      notification_preferences: {
        [notificationType]: { email: false, push: true, in_app: false },
      },
    });

    await NotificationService.sendNotification({
      userId: "user-1",
      type: notificationType,
      channels: allChannels,
    });

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it("allows all channels when preferences are not configured", async () => {
    findById.mockResolvedValue(null);

    const preferences = await NotificationService.getUserPreferences("user-1");

    expect(NotificationService.filterChannelsByPreferences(
      allChannels,
      preferences,
      notificationType,
    )).toEqual(allChannels);
    expect(preferences[notificationType]).toEqual({
      email: true,
      push: true,
      in_app: true,
    });
  });

  it("returns the default preferences with every supported channel enabled", () => {
    const preferences = NotificationService.getDefaultPreferences();

    expect(Object.values(preferences)).toHaveLength(11);
    expect(Object.values(preferences).every((channels) =>
      channels.email && channels.push && channels.in_app,
    )).toBe(true);
  });
});
