import { SmartSchedulingService } from "../../smart-scheduling.service";
import pool from "../../../config/database";
import { createError } from "../../../middleware/errorHandler";

jest.mock("../../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  },
}));

describe("SmartSchedulingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("suggestOptimalTimes", () => {
    it("should throw 404 if mentor is not found", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // Users query

      await expect(
        SmartSchedulingService.suggestOptimalTimes("mentor-1", "mentee-1"),
      ).rejects.toThrow("Mentor not found or inactive");
    });

    it("should suggest optimal times successfully with default/fallback logic", async () => {
      // Mock Users Query
      const mockUsers = [
        {
          id: "mentor-1",
          timezone: "America/New_York",
          availability_schedule: null,
        },
        { id: "mentee-1", timezone: "Europe/London" },
      ];
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: mockUsers }) // Users query
        .mockResolvedValueOnce({ rows: [] }) // Bookings query (no conflicts)
        .mockResolvedValueOnce({ rows: [] }); // History query (no history)

      const suggestions = await SmartSchedulingService.suggestOptimalTimes(
        "mentor-1",
        "mentee-1",
        60,
        new Date("2026-06-01T00:00:00Z"),
        new Date("2026-06-02T00:00:00Z"),
      );

      expect(suggestions).toBeInstanceOf(Array);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]).toHaveProperty("suggestedTimes");
      expect(suggestions[0]).toHaveProperty("confidence");
      expect(suggestions[0]).toHaveProperty("reasoning");
      expect(suggestions[0].factors).toHaveProperty("timezoneOptimal");
    });

    it("should filter out conflicting slots", async () => {
      const mockUsers = [
        {
          id: "mentor-1",
          timezone: "UTC",
          availability_schedule: {
            monday: {
              enabled: true,
              slots: [{ start: "09:00", end: "10:00" }],
            },
          },
        },
        { id: "mentee-1", timezone: "UTC" },
      ];

      const mockBookings = [
        {
          id: "b-1",
          scheduled_start: "2026-06-01T09:00:00Z", // Monday 9:00 - 10:00
          scheduled_end: "2026-06-01T10:00:00Z",
        },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: mockUsers }) // Users
        .mockResolvedValueOnce({ rows: mockBookings }) // Bookings (conflict)
        .mockResolvedValueOnce({ rows: [] }); // History

      const suggestions = await SmartSchedulingService.suggestOptimalTimes(
        "mentor-1",
        "mentee-1",
        60,
        new Date("2026-06-01T00:00:00Z"), // Monday
        new Date("2026-06-01T23:59:59Z"),
      );

      // Since the only available slot (09:00-10:00) has a conflict, we should get 0 suggestions
      expect(suggestions).toHaveLength(0);
    });

    it("should factor in historical success", async () => {
      const mockUsers = [
        { id: "mentor-1", timezone: "UTC", availability_schedule: null },
        { id: "mentee-1", timezone: "UTC" },
      ];

      const mockHistory = [
        { status: "completed", scheduled_start: "2026-05-25T10:00:00Z" }, // Past Monday at 10:00
        { status: "completed", scheduled_start: "2026-05-25T10:30:00Z" },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: mockUsers }) // Users
        .mockResolvedValueOnce({ rows: [] }) // Bookings
        .mockResolvedValueOnce({ rows: mockHistory }); // History

      const suggestions = await SmartSchedulingService.suggestOptimalTimes(
        "mentor-1",
        "mentee-1",
        60,
        new Date("2026-06-01T00:00:00Z"), // Next Monday
        new Date("2026-06-01T23:59:59Z"),
      );

      expect(suggestions.length).toBeGreaterThan(0);
      // The slot around Monday 10:00 should have a very high confidence boost because of high historical success
      expect(suggestions[0].factors.historicalSuccess).toBeGreaterThanOrEqual(
        0.7,
      );
    });
  });

  describe("suggestReschedule", () => {
    it("should throw error if booking does not exist", async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] }); // Booking query

      await expect(
        SmartSchedulingService.suggestReschedule("booking-1", "user-1"),
      ).rejects.toThrow("Booking not found");
    });

    it("should throw error if unauthorized user requests reschedule", async () => {
      const mockBooking = {
        mentor_id: "mentor-1",
        mentee_id: "mentee-1",
        duration_minutes: 60,
      };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockBooking] }); // Booking query

      await expect(
        SmartSchedulingService.suggestReschedule("booking-1", "stranger-1"),
      ).rejects.toThrow("Access denied");
    });

    it("should suggest optimal reschedule times successfully", async () => {
      const mockBooking = {
        mentor_id: "mentor-1",
        mentee_id: "mentee-1",
        duration_minutes: 60,
      };
      const mockUsers = [
        {
          id: "mentor-1",
          timezone: "America/New_York",
          availability_schedule: null,
        },
        { id: "mentee-1", timezone: "Europe/London" },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockBooking] }) // Booking query
        .mockResolvedValueOnce({ rows: mockUsers }) // Users query
        .mockResolvedValueOnce({ rows: [] }) // Bookings query (no conflicts)
        .mockResolvedValueOnce({ rows: [] }); // History query (no history)

      const suggestions = await SmartSchedulingService.suggestReschedule(
        "booking-1",
        "mentor-1",
      );

      expect(suggestions).toBeInstanceOf(Array);
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });
});
