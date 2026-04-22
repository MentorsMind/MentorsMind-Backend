import { BookingsService as SessionsService } from "../../services/bookings.service";
import { BookingModel } from "../../models/booking.model";
import { CacheService } from "../../services/cache.service";
import { SocketService } from "../../services/socket.service";
import pool from "../../config/database";
// Mock external dependencies
jest.mock("../../models/booking.model");
jest.mock("../../services/cache.service");
jest.mock("../../services/socket.service");
jest.mock("../../config/database");

const mockBookingModel = BookingModel as jest.Mocked<typeof BookingModel>;
const mockCacheService = CacheService as jest.Mocked<typeof CacheService>;
const mockSocketService = SocketService as jest.Mocked<typeof SocketService>;
const mockPool = pool as jest.Mocked<typeof pool>;

describe("SessionsService (BookingsService)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("initialize", () => {
    it("should initialize the booking table", async () => {
      mockBookingModel.initializeTable.mockResolvedValue();

      await SessionsService.initialize();

      expect(mockBookingModel.initializeTable).toHaveBeenCalled();
    });
  });

  describe("createBooking", () => {
    it("should create a booking successfully", async () => {
      const data = {
        menteeId: "mentee-123",
        mentorId: "mentor-123",
        scheduledAt: new Date("2023-01-15T10:00:00Z"),
        durationMinutes: 60,
        topic: "JavaScript mentoring",
        notes: "Test notes",
      };

      const mockUsers = [
        { id: "mentee-123", role: "learner" },
        { id: "mentor-123", role: "mentor" },
      ];

      const mockBooking = {
        id: "booking-123",
        mentee_id: data.menteeId,
        mentor_id: data.mentorId,
        scheduled_at: data.scheduledAt,
        duration_minutes: data.durationMinutes,
        topic: data.topic,
        status: "pending",
      };

      mockPool.query.mockResolvedValue({ rows: mockUsers });
      mockBookingModel.checkConflict.mockResolvedValue(false);
      mockBookingModel.create.mockResolvedValue(mockBooking as any);

      const result = await SessionsService.createBooking(data);

      expect(result).toEqual(mockBooking);
      expect(mockBookingModel.checkConflict).toHaveBeenCalled();
      expect(mockBookingModel.create).toHaveBeenCalled();
    });

    it("should throw error if mentee not found", async () => {
      const data = {
        menteeId: "nonexistent",
        mentorId: "mentor-123",
        scheduledAt: new Date(),
        durationMinutes: 60,
        topic: "Test",
      };

      mockPool.query.mockResolvedValue({
        rows: [{ id: "mentor-123", role: "mentor" }],
      });

      await expect(SessionsService.createBooking(data)).rejects.toThrow(
        "Mentee not found",
      );
    });

    it("should throw error if mentor not found", async () => {
      const data = {
        menteeId: "mentee-123",
        mentorId: "nonexistent",
        scheduledAt: new Date(),
        durationMinutes: 60,
        topic: "Test",
      };

      mockPool.query.mockResolvedValue({
        rows: [{ id: "mentee-123", role: "mentee" }],
      });

      await expect(SessionsService.createBooking(data)).rejects.toThrow(
        "Mentor not found",
      );
    });

    it("should throw error if user is not a mentor", async () => {
      const data = {
        menteeId: "mentee-123",
        mentorId: "user-123",
        scheduledAt: new Date(),
        durationMinutes: 60,
        topic: "Test",
      };

      const mockUsers = [
        { id: "mentee-123", role: "learner" },
        { id: "user-123", role: "learner" },
      ];

      mockPool.query.mockResolvedValue({ rows: mockUsers });

      await expect(SessionsService.createBooking(data)).rejects.toThrow(
        "User is not a mentor",
      );
    });

    it("should throw error if mentor has conflict", async () => {
      const data = {
        menteeId: "mentee-123",
        mentorId: "mentor-123",
        scheduledAt: new Date(),
        durationMinutes: 60,
        topic: "Test",
      };

      const mockUsers = [
        { id: "mentee-123", role: "learner" },
        { id: "mentor-123", role: "mentor" },
      ];

      mockPool.query.mockResolvedValue({ rows: mockUsers });
      mockBookingModel.checkConflict.mockResolvedValue(true);

      await expect(SessionsService.createBooking(data)).rejects.toThrow(
        "Mentor is not available at the requested time",
      );
    });
  });

  describe("getBookingById", () => {
    it("should return booking if user has access", async () => {
      const bookingId = "booking-123";
      const userId = "mentee-123";

      const mockBooking = {
        id: bookingId,
        mentee_id: userId,
        mentor_id: "mentor-123",
        status: "pending",
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);

      const result = await SessionsService.getBookingById(bookingId, userId);

      expect(result).toEqual(mockBooking);
    });

    it("should throw error if booking not found", async () => {
      const bookingId = "nonexistent";
      const userId = "user-123";

      mockBookingModel.findById.mockResolvedValue(null);

      await expect(
        SessionsService.getBookingById(bookingId, userId),
      ).rejects.toThrow("Booking not found");
    });

    it("should throw error if user has no access", async () => {
      const bookingId = "booking-123";
      const userId = "unauthorized-user";

      const mockBooking = {
        id: bookingId,
        mentee_id: "mentee-123",
        mentor_id: "mentor-123",
        status: "pending",
      };

      mockBookingModel.findById.mockResolvedValue(mockBooking as any);

      await expect(
        SessionsService.getBookingById(bookingId, userId),
      ).rejects.toThrow("Access denied");
    });
  });

  describe("getUserBookings", () => {
    it("should return cached bookings if available", async () => {
      const userId = "user-123";
      const mockResult = {
        bookings: [{ id: "booking-1" }],
        total: 1,
      };

      mockCacheService.get.mockResolvedValue(mockResult);

      const result = await SessionsService.getUserBookings(userId);

      expect(result).toEqual(mockResult);
      expect(mockCacheService.get).toHaveBeenCalled();
      expect(mockBookingModel.findByUserId).not.toHaveBeenCalled();
    });

    it("should fetch from database and cache if not cached", async () => {
      const userId = "user-123";
      const mockResult = {
        bookings: [{ id: "booking-1" }],
        total: 1,
      };

      mockCacheService.get.mockResolvedValue(null);
      mockBookingModel.findByUserId.mockResolvedValue(mockResult);
      mockCacheService.set.mockResolvedValue(true);

      const result = await SessionsService.getUserBookings(userId);

      expect(result).toEqual(mockResult);
      expect(mockBookingModel.findByUserId).toHaveBeenCalledWith(
        userId,
        undefined,
      );
      expect(mockCacheService.set).toHaveBeenCalled();
    });
  });

  describe("updateBooking", () => {
    it("should update booking successfully", async () => {
      const bookingId = "booking-123";
      const userId = "mentee-123";
      const data = {
        topic: "Updated topic",
        notes: "Updated notes",
      };

      const mockBooking = {
        id: bookingId,
        mentee_id: userId,
        mentor_id: "mentor-123",
        status: "pending",
        scheduled_at: new Date(),
        duration_minutes: 60,
      };

      const mockUpdated = {
        ...mockBooking,
        topic: data.topic,
        notes: data.notes,
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);
      mockBookingModel.checkConflict.mockResolvedValue(false);
      mockBookingModel.update.mockResolvedValue(mockUpdated as any);
      mockCacheService.del.mockResolvedValue(true);

      const result = await SessionsService.updateBooking(
        bookingId,
        userId,
        data,
      );

      expect(result).toEqual(mockUpdated);
      expect(mockCacheService.del).toHaveBeenCalledTimes(2);
    });

    it("should throw error if booking status is not updatable", async () => {
      const bookingId = "booking-123";
      const userId = "mentee-123";
      const data = { topic: "New topic" };

      const mockBooking = {
        id: bookingId,
        mentee_id: userId,
        mentor_id: "mentor-123",
        status: "completed",
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);

      await expect(
        SessionsService.updateBooking(bookingId, userId, data),
      ).rejects.toThrow("Cannot update booking in current status");
    });
  });

  describe("confirmBooking", () => {
    it("should confirm booking successfully", async () => {
      const bookingId = "booking-123";
      const userId = "mentor-123";

      const mockBooking = {
        id: bookingId,
        mentee_id: "mentee-123",
        mentor_id: userId,
        status: "pending",
        payment_status: "paid",
      };

      const mockUpdated = {
        ...mockBooking,
        status: "confirmed",
        updated_at: new Date(),
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);
      mockBookingModel.update.mockResolvedValue(mockUpdated as any);
      mockCacheService.del.mockResolvedValue(true);
      mockSocketService.emitToUser.mockResolvedValue();

      const result = await SessionsService.confirmBooking(bookingId, userId);

      expect(result).toEqual(mockUpdated);
      expect(mockSocketService.emitToUser).toHaveBeenCalledTimes(2);
    });

    it("should throw error if not mentor", async () => {
      const bookingId = "booking-123";
      const userId = "mentee-123";

      const mockBooking = {
        id: bookingId,
        mentee_id: userId,
        mentor_id: "mentor-123",
        status: "pending",
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);

      await expect(
        SessionsService.confirmBooking(bookingId, userId),
      ).rejects.toThrow("Only the mentor can confirm bookings");
    });
  });

  describe("completeBooking", () => {
    it("should complete booking successfully", async () => {
      const bookingId = "booking-123";
      const userId = "mentor-123";

      const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
      const mockBooking = {
        id: bookingId,
        mentee_id: "mentee-123",
        mentor_id: userId,
        status: "confirmed",
        scheduled_at: pastDate,
        duration_minutes: 60,
      };

      const mockUpdated = {
        ...mockBooking,
        status: "completed",
        updated_at: new Date(),
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);
      mockBookingModel.update.mockResolvedValue(mockUpdated as any);
      mockCacheService.del.mockResolvedValue(true);
      mockSocketService.emitToUser.mockResolvedValue();

      const result = await SessionsService.completeBooking(bookingId, userId);

      expect(result).toEqual(mockUpdated);
      expect(mockSocketService.emitToUser).toHaveBeenCalledTimes(2);
    });

    it("should throw error if session not ended", async () => {
      const bookingId = "booking-123";
      const userId = "mentor-123";

      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      const mockBooking = {
        id: bookingId,
        mentee_id: "mentee-123",
        mentor_id: userId,
        status: "confirmed",
        scheduled_at: futureDate,
        duration_minutes: 60,
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);

      await expect(
        SessionsService.completeBooking(bookingId, userId),
      ).rejects.toThrow("Cannot complete booking before session ends");
    });
  });

  describe("cancelBooking", () => {
    it("should cancel booking successfully", async () => {
      const bookingId = "booking-123";
      const userId = "mentee-123";
      const reason = "Test cancellation";

      const mockBooking = {
        id: bookingId,
        mentee_id: userId,
        mentor_id: "mentor-123",
        status: "pending",
        scheduled_at: new Date(Date.now() + 86400000), // Tomorrow
        payment_status: "paid",
      };

      const mockUpdated = {
        ...mockBooking,
        status: "cancelled",
        updated_at: new Date(),
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);
      mockBookingModel.update.mockResolvedValue(mockUpdated as any);
      mockCacheService.del.mockResolvedValue(true);
      mockSocketService.emitToUser.mockResolvedValue();

      const result = await SessionsService.cancelBooking(
        bookingId,
        userId,
        reason,
      );

      expect(result).toEqual(mockUpdated);
      expect(mockSocketService.emitToUser).toHaveBeenCalledTimes(2);
    });
  });

  describe("rescheduleBooking", () => {
    it("should reschedule booking successfully", async () => {
      const bookingId = "booking-123";
      const userId = "mentee-123";
      const newScheduledAt = new Date("2023-01-16T10:00:00Z");

      const mockBooking = {
        id: bookingId,
        mentee_id: userId,
        mentor_id: "mentor-123",
        status: "pending",
        scheduled_at: new Date("2023-01-15T10:00:00Z"),
        duration_minutes: 60,
        notes: "Original notes",
      };

      const mockUpdated = {
        ...mockBooking,
        scheduled_at: newScheduledAt,
        status: "rescheduled",
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);
      mockBookingModel.checkConflict.mockResolvedValue(false);
      mockBookingModel.update.mockResolvedValue(mockUpdated as any);
      mockSocketService.emitToUser.mockResolvedValue();

      const result = await SessionsService.rescheduleBooking(
        bookingId,
        userId,
        newScheduledAt,
      );

      expect(result).toEqual(mockUpdated);
      expect(mockSocketService.emitToUser).toHaveBeenCalledTimes(2);
    });
  });

  describe("getPaymentStatus", () => {
    it("should return payment status", async () => {
      const bookingId = "booking-123";
      const userId = "mentee-123";

      const mockBooking = {
        id: bookingId,
        mentee_id: userId,
        payment_status: "paid",
        amount: "50.0000000",
        currency: "XLM",
        stellar_tx_hash: "hash123",
        transaction_id: "tx123",
      };

      jest
        .spyOn(SessionsService, "getBookingById")
        .mockResolvedValue(mockBooking as any);

      const result = await SessionsService.getPaymentStatus(bookingId, userId);

      expect(result).toEqual({
        paymentStatus: "paid",
        amount: "50.0000000",
        currency: "XLM",
        stellarTxHash: "hash123",
        transactionId: "tx123",
      });
    });
  });

  describe("updatePaymentStatus", () => {
    it("should update payment status successfully", async () => {
      const bookingId = "booking-123";
      const stellarTxHash = "hash123";
      const transactionId = "tx123";

      const mockUpdated = {
        id: bookingId,
        payment_status: "paid",
        stellar_tx_hash: stellarTxHash,
        transaction_id: transactionId,
      };

      mockBookingModel.update.mockResolvedValue(mockUpdated as any);

      const result = await SessionsService.updatePaymentStatus(
        bookingId,
        stellarTxHash,
        transactionId,
      );

      expect(result).toEqual(mockUpdated);
    });
  });
});
