import pool from "../../config/database";
import { BookingModel, BookingRecord } from "../../models/booking.model";
import { BookingsService } from "../../services/bookings.service";
import { CacheService } from "../../services/cache.service";
import { SocketService } from "../../services/socket.service";

jest.mock("../../config/database");
jest.mock("../../models/booking.model");
jest.mock("../../services/cache.service");
jest.mock("../../services/socket.service");

const mockPool = pool as unknown as { query: jest.Mock };
const mockBookingModel = BookingModel as jest.Mocked<typeof BookingModel>;
const mockCache = CacheService as jest.Mocked<typeof CacheService>;
const mockSocket = SocketService as jest.Mocked<typeof SocketService>;

function baseBooking(overrides: Partial<BookingRecord> = {}): BookingRecord {
  const now = new Date();
  return {
    id: "booking-1",
    mentee_id: "mentee-1",
    mentor_id: "mentor-1",
    scheduled_at: new Date("2030-06-01T10:00:00Z"),
    duration_minutes: 60,
    topic: "Topic",
    notes: null,
    status: "pending",
    amount: "50.0000000",
    currency: "XLM",
    payment_status: "pending",
    stellar_tx_hash: null,
    transaction_id: null,
    cancellation_reason: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("BookingsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("initialize", () => {
    it("inicializa la tabla de reservas", async () => {
      mockBookingModel.initializeTable.mockResolvedValue(undefined);

      await BookingsService.initialize();

      expect(mockBookingModel.initializeTable).toHaveBeenCalled();
    });

    it("propaga error de inicialización", async () => {
      mockBookingModel.initializeTable.mockRejectedValue(
        new Error("migration failed"),
      );

      await expect(BookingsService.initialize()).rejects.toThrow(
        "migration failed",
      );
    });
  });

  describe("createBooking", () => {
    const createData = {
      menteeId: "mentee-1",
      mentorId: "mentor-1",
      scheduledAt: new Date("2030-06-01T10:00:00Z"),
      durationMinutes: 60,
      topic: "Math",
    };

    it("crea reserva cuando usuarios y horario son válidos", async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: "mentee-1", role: "learner" },
          { id: "mentor-1", role: "mentor" },
        ],
      });
      mockBookingModel.checkConflict.mockResolvedValue(false);
      const created = baseBooking();
      mockBookingModel.create.mockResolvedValue(created);

      const result = await BookingsService.createBooking(createData);

      expect(result).toEqual(created);
      expect(mockBookingModel.create).toHaveBeenCalled();
    });

    it("valida que exista el mentee", async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: "mentor-1", role: "mentor" }],
      });

      await expect(BookingsService.createBooking(createData)).rejects.toThrow(
        "Mentee not found",
      );
    });

    it("valida que exista el mentor", async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ id: "mentee-1", role: "mentee" }],
      });

      await expect(BookingsService.createBooking(createData)).rejects.toThrow(
        "Mentor not found",
      );
    });

    it("valida rol mentor", async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: "mentee-1", role: "mentee" },
          { id: "mentor-1", role: "mentor" },
        ],
      });

      await expect(BookingsService.createBooking(createData)).rejects.toThrow(
        "User is not a mentor",
      );
    });

    it("detecta conflicto de agenda", async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          { id: "mentee-1", role: "learner" },
          { id: "mentor-1", role: "mentor" },
        ],
      });
      mockBookingModel.checkConflict.mockResolvedValue(true);

      await expect(BookingsService.createBooking(createData)).rejects.toThrow(
        "Mentor is not available at the requested time",
      );
    });

    it("propaga fallo de base de datos al validar usuarios", async () => {
      mockPool.query.mockRejectedValue(new Error("connection lost"));

      await expect(BookingsService.createBooking(createData)).rejects.toThrow(
        "connection lost",
      );
    });
  });

  describe("getBookingById", () => {
    it("devuelve reserva para mentee o mentor", async () => {
      const b = baseBooking();
      mockBookingModel.findById.mockResolvedValue(b);

      const result = await BookingsService.getBookingById(
        "booking-1",
        "mentee-1",
      );

      expect(result).toEqual(b);
    });

    it("404 si no existe", async () => {
      mockBookingModel.findById.mockResolvedValue(null);

      await expect(BookingsService.getBookingById("x", "user")).rejects.toThrow(
        "Booking not found",
      );
    });

    it("403 si el usuario no participa", async () => {
      mockBookingModel.findById.mockResolvedValue(baseBooking());

      await expect(
        BookingsService.getBookingById("booking-1", "stranger"),
      ).rejects.toThrow("Access denied");
    });
  });

  describe("getUserBookings", () => {
    it("devuelve cache si existe", async () => {
      const cached = { bookings: [baseBooking()], total: 1 };
      mockCache.get.mockResolvedValue(cached);

      const result = await BookingsService.getUserBookings("user-1");

      expect(result).toEqual(cached);
      expect(mockBookingModel.findByUserId).not.toHaveBeenCalled();
    });

    it("consulta modelo y guarda en cache si no hay cache", async () => {
      mockCache.get.mockResolvedValue(null);
      const data = { bookings: [baseBooking()], total: 1 };
      mockBookingModel.findByUserId.mockResolvedValue(data);
      mockCache.set.mockResolvedValue(undefined);

      const result = await BookingsService.getUserBookings("user-1");

      expect(result).toEqual(data);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it("propaga error del modelo", async () => {
      mockCache.get.mockResolvedValue(null);
      mockBookingModel.findByUserId.mockRejectedValue(new Error("db error"));

      await expect(BookingsService.getUserBookings("user-1")).rejects.toThrow(
        "db error",
      );
    });
  });

  describe("updateBooking", () => {
    it("actualiza y limpia cache", async () => {
      const booking = baseBooking({ status: "pending" });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);
      mockBookingModel.checkConflict.mockResolvedValue(false);
      const updated = { ...booking, topic: "New" };
      mockBookingModel.update.mockResolvedValue(updated);
      mockCache.del.mockResolvedValue(undefined);

      const result = await BookingsService.updateBooking(
        "booking-1",
        "mentee-1",
        { topic: "New" },
      );

      expect(result.topic).toBe("New");
      expect(mockCache.del).toHaveBeenCalled();
    });

    it("valida estado de la reserva", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(baseBooking({ status: "completed" }));

      await expect(
        BookingsService.updateBooking("booking-1", "mentee-1", { topic: "x" }),
      ).rejects.toThrow("Cannot update booking in current status");
    });

    it("solo el mentee puede editar", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(baseBooking({ status: "pending" }));

      await expect(
        BookingsService.updateBooking("booking-1", "mentor-1", { topic: "x" }),
      ).rejects.toThrow("Only the mentee can update booking details");
    });

    it("falla si update devuelve null", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(baseBooking({ status: "pending" }));
      mockBookingModel.checkConflict.mockResolvedValue(false);
      mockBookingModel.update.mockResolvedValue(null);

      await expect(
        BookingsService.updateBooking("booking-1", "mentee-1", { topic: "x" }),
      ).rejects.toThrow("Failed to update booking");
    });
  });

  describe("confirmBooking", () => {
    it("confirma como mentor con pago completado", async () => {
      const booking = baseBooking({
        mentor_id: "mentor-1",
        mentee_id: "mentee-1",
        status: "pending",
        payment_status: "paid",
      });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);
      const updated = { ...booking, status: "confirmed" as const };
      mockBookingModel.update.mockResolvedValue(updated);
      mockCache.del.mockResolvedValue(undefined);

      const result = await BookingsService.confirmBooking(
        "booking-1",
        "mentor-1",
      );

      expect(result.status).toBe("confirmed");
      expect(mockSocket.emitToUser).toHaveBeenCalled();
    });

    it("solo el mentor puede confirmar", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(
          baseBooking({ status: "pending", payment_status: "paid" }),
        );

      await expect(
        BookingsService.confirmBooking("booking-1", "mentee-1"),
      ).rejects.toThrow("Only the mentor can confirm bookings");
    });

    it("exige pago antes de confirmar", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(
          baseBooking({
            mentor_id: "mentor-1",
            status: "pending",
            payment_status: "pending",
          }),
        );

      await expect(
        BookingsService.confirmBooking("booking-1", "mentor-1"),
      ).rejects.toThrow("Payment must be completed before confirmation");
    });
  });

  describe("completeBooking", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2030-06-01T12:00:00Z"));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("completa sesión ya finalizada", async () => {
      const booking = baseBooking({
        mentee_id: "mentee-1",
        mentor_id: "mentor-1",
        status: "confirmed",
        scheduled_at: new Date("2030-06-01T10:00:00Z"),
        duration_minutes: 60,
      });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);
      const updated = { ...booking, status: "completed" as const };
      mockBookingModel.update.mockResolvedValue(updated);
      mockCache.del.mockResolvedValue(undefined);

      const result = await BookingsService.completeBooking(
        "booking-1",
        "mentee-1",
      );

      expect(result.status).toBe("completed");
    });

    it("no completa antes de terminar la sesión", async () => {
      jest.setSystemTime(new Date("2030-06-01T10:30:00Z"));
      const booking = baseBooking({
        status: "confirmed",
        scheduled_at: new Date("2030-06-01T10:00:00Z"),
        duration_minutes: 60,
      });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);

      await expect(
        BookingsService.completeBooking("booking-1", "mentee-1"),
      ).rejects.toThrow("Cannot complete booking before session ends");
    });

    it("valida estado confirmed", async () => {
      const booking = baseBooking({
        status: "pending",
        scheduled_at: new Date("2020-01-01T10:00:00Z"),
        duration_minutes: 60,
      });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);

      await expect(
        BookingsService.completeBooking("booking-1", "mentee-1"),
      ).rejects.toThrow("Only confirmed bookings can be completed");
    });
  });

  describe("cancelBooking", () => {
    it("cancela reserva pendiente", async () => {
      const booking = baseBooking({ status: "pending" });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);
      const updated = { ...booking, status: "cancelled" as const };
      mockBookingModel.update.mockResolvedValue(updated);
      mockCache.del.mockResolvedValue(undefined);

      const result = await BookingsService.cancelBooking(
        "booking-1",
        "mentee-1",
        "reason",
      );

      expect(result.status).toBe("cancelled");
    });

    it("no cancela si ya está terminada", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(baseBooking({ status: "completed" }));

      await expect(
        BookingsService.cancelBooking("booking-1", "mentee-1"),
      ).rejects.toThrow("Cannot cancel booking in current status");
    });

    it("falla si update devuelve null", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(baseBooking({ status: "pending" }));
      mockBookingModel.update.mockResolvedValue(null);

      await expect(
        BookingsService.cancelBooking("booking-1", "mentee-1"),
      ).rejects.toThrow("Failed to cancel booking");
    });
  });

  describe("rescheduleBooking", () => {
    it("reprograma sin conflicto", async () => {
      const booking = baseBooking({ status: "pending" });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);
      mockBookingModel.checkConflict.mockResolvedValue(false);
      const newDate = new Date("2030-07-01T10:00:00Z");
      const updated = {
        ...booking,
        status: "rescheduled" as const,
        scheduled_at: newDate,
      };
      mockBookingModel.update.mockResolvedValue(updated);

      const result = await BookingsService.rescheduleBooking(
        "booking-1",
        "mentee-1",
        newDate,
        "viaje",
      );

      expect(result.status).toBe("rescheduled");
      expect(mockSocket.emitToUser).toHaveBeenCalled();
    });

    it("valida estado", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(baseBooking({ status: "completed" }));

      await expect(
        BookingsService.rescheduleBooking(
          "booking-1",
          "mentee-1",
          new Date(),
          "x",
        ),
      ).rejects.toThrow("Cannot reschedule booking in current status");
    });

    it("detecta conflicto al reprogramar", async () => {
      jest
        .spyOn(BookingsService, "getBookingById")
        .mockResolvedValue(baseBooking({ status: "pending" }));
      mockBookingModel.checkConflict.mockResolvedValue(true);

      await expect(
        BookingsService.rescheduleBooking(
          "booking-1",
          "mentee-1",
          new Date("2030-08-01T10:00:00Z"),
          "x",
        ),
      ).rejects.toThrow("Mentor is not available at the requested time");
    });
  });

  describe("getPaymentStatus", () => {
    it("expone estado de pago de la reserva", async () => {
      const booking = baseBooking({
        payment_status: "paid",
        amount: "10",
        stellar_tx_hash: "h",
        transaction_id: "t1",
      });
      jest.spyOn(BookingsService, "getBookingById").mockResolvedValue(booking);

      const result = await BookingsService.getPaymentStatus(
        "booking-1",
        "mentee-1",
      );

      expect(result).toEqual({
        paymentStatus: "paid",
        amount: "10",
        currency: "XLM",
        stellarTxHash: "h",
        transactionId: "t1",
      });
    });
  });

  describe("updatePaymentStatus", () => {
    it("actualiza a pagado", async () => {
      const updated = baseBooking({ payment_status: "paid" });
      mockBookingModel.update.mockResolvedValue(updated);

      const result = await BookingsService.updatePaymentStatus(
        "booking-1",
        "hash",
        "tx-id",
      );

      expect(result.payment_status).toBe("paid");
    });

    it("falla si update devuelve null", async () => {
      mockBookingModel.update.mockResolvedValue(null);

      await expect(
        BookingsService.updatePaymentStatus("booking-1", "hash", "tx-id"),
      ).rejects.toThrow("Failed to update payment status");
    });
  });
});
