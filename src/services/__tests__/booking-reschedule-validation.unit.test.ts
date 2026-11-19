jest.mock("../../config/database", () => ({
  db: { query: jest.fn(), connect: jest.fn() },
}));
jest.mock("../database.service", () => ({
  DatabaseService: { withTransaction: jest.fn() },
}));
jest.mock("../event-store.service", () => ({
  EventStoreService: { publishEvent: jest.fn() },
}));
jest.mock("../outbox.service", () => ({
  emitBookingConfirmed: jest.fn(),
}));
jest.mock("../notification.service", () => ({
  NotificationService: { sendNotification: jest.fn() },
}));
jest.mock("../mentors.service", () => ({
  MentorsService: { findById: jest.fn() },
}));
jest.mock("../loyalty.service", () => ({
  LoyaltyService: { getDiscountBps: jest.fn(), accruePointsForCompletion: jest.fn() },
}));
jest.mock("../../models/session-summary.model", () => ({
  SessionSummaryModel: { generateAndStore: jest.fn(() => Promise.resolve()) },
}));
import { BookingsService } from "../bookings.service";
import { BookingModel } from "../../models/booking.model";
import { ErrorCode } from "../../errors/error-codes";
import { rescheduleBookingSchema } from "../../validators/schemas/bookings.schemas";

jest.mock("../../models/booking.model", () => ({
  BookingModel: {
    findById: jest.fn(),
    checkConflict: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock("../cache.service", () => ({
  CacheService: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock("../calendar.service", () => ({
  CalendarService: {
    updateGoogleCalendarEvent: jest.fn(() => Promise.resolve()),
    createGoogleCalendarEvent: jest.fn(() => Promise.resolve()),
    deleteGoogleCalendarEvent: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock("../sorobanEscrow.service", () => ({
  SorobanEscrowService: { isConfigured: jest.fn(() => false) },
}));
jest.mock("../queue.service", () => ({ QueueService: {} }));

const mockedFindById = BookingModel.findById as unknown as jest.Mock;
const mockedCheckConflict = BookingModel.checkConflict as unknown as jest.Mock;
const mockedUpdate = BookingModel.update as unknown as jest.Mock;

describe("BookingsService.rescheduleBooking future validation (issue #1299)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindById.mockResolvedValue({
      id: "booking-1",
      mentee_id: "mentee-1",
      mentor_id: "mentor-1",
      status: "pending",
      duration_minutes: 60,
      notes: "test",
    });
    mockedCheckConflict.mockResolvedValue(false);
    mockedUpdate.mockResolvedValue({ id: "booking-1" });
  });

  it("rejects past times with BOOKING_INVALID_TIME before any DB writes", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);

    await expect(
      BookingsService.rescheduleBooking("booking-1", "mentee-1", past),
    ).rejects.toMatchObject({ code: ErrorCode.BOOKING_INVALID_TIME });

    expect(mockedCheckConflict).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("rejects times less than 30 minutes in the future", async () => {
    const tooSoon = new Date(Date.now() + 10 * 60 * 1000);

    await expect(
      BookingsService.rescheduleBooking("booking-1", "mentee-1", tooSoon),
    ).rejects.toMatchObject({ code: ErrorCode.BOOKING_INVALID_TIME });
  });

  it("accepts times more than 30 minutes in the future", async () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const result = await BookingsService.rescheduleBooking(
      "booking-1",
      "mentee-1",
      future,
    );

    expect(result.id).toBe("booking-1");
    expect(mockedUpdate).toHaveBeenCalled();
  });

  it("reschedule Zod schema rejects past scheduledAt", () => {
    const pastIso = new Date(Date.now() - 1000).toISOString();

    const parsed = rescheduleBookingSchema.safeParse({
      params: { id: "123e4567-e89b-12d3-a456-426614174000" },
      body: { scheduledAt: pastIso },
    });

    expect(parsed.success).toBe(false);
  });
});
