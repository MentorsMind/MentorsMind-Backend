/**
 * Integration test for BookingModel.findByUser() pagination.
 *
 * Tests verify that:
 * 1. Page 1 returns first N results (ordered by scheduled_at DESC)
 * 2. Page 2 returns next N results
 * 3. Filtered results paginate correctly with status filter
 * 4. Parameter indices are correct (no off-by-one errors)
 */

import pool from "../../../src/config/database";
import { BookingModel } from "../../../src/models/booking.model";

const BOOKINGS_PER_PAGE = 3;

describe("BookingModel findByUser Pagination Integration", () => {
  let createdIds: string[] = [];

  beforeAll(async () => {
    // Clean up bookings table
    await pool.query(`DELETE FROM bookings`);
  });

  afterEach(async () => {
    // Clean up bookings created in tests
    if (createdIds.length > 0) {
      await pool.query(`DELETE FROM bookings WHERE id IN (${createdIds.map((_, i) => `$${i + 1}`).join(", ")})`, createdIds);
    }
    createdIds = [];
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("unfiltered pagination", () => {
    it("should return page 1 with first N results", async () => {
      // Arrange: Create 5 bookings with staggered dates
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        const scheduledAt = new Date();
        scheduledAt.setDate(now.getDate() - i); // i=0 is most recent, i=4 is oldest

        const booking = await BookingModel.create({
          menteeId: `mentee-${i}`,
          mentorId: `mentor-${i}`,
          scheduledAt,
          durationMinutes: 60,
          topic: `Test topic ${i}`,
          amount: "100.00",
          currency: "USD",
        });

        createdIds.push(booking.id);
      }

      // Act: Get page 1 (first 3 results)
      const page1 = await BookingModel.findByUser("user-1", { page: 1, limit: BOOKINGS_PER_PAGE });
      const page2 = await BookingModel.findByUser("user-1", { page: 2, limit: BOOKINGS_PER_PAGE });

      // Assert page 1 has 3 bookings
      expect(page1.bookings).toHaveLength(BOOKINGS_PER_PAGE);
      // Bookings should be ordered by scheduled_at DESC (most recent first)
      expect(page1.bookings[0].scheduled_at).toBeGreaterThanOrEqual(page1.bookings[1].scheduled_at);
      expect(page1.bookings[1].scheduled_at).toBeGreaterThanOrEqual(page1.bookings[2].scheduled_at);

      // Assert page 2 has 2 remaining bookings
      expect(page2.bookings).toHaveLength(2);
    });

    it("should correct pagination across multiple pages", async () => {
      // Arrange: Create 10 bookings
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        const scheduledAt = new Date();
        scheduledAt.setDate(now.getDate() - i);

        const booking = await BookingModel.create({
          menteeId: `mentee-${i}`,
          mentorId: `mentor-${i}`,
          scheduledAt,
          durationMinutes: 60,
          topic: `Test topic ${i}`,
          amount: "100.00",
          currency: "USD",
        });

        createdIds.push(booking.id);
      }

      // Act: Get all pages
      const page1 = await BookingModel.findByUser("user-1", { page: 1, limit: BOOKINGS_PER_PAGE });
      const page2 = await BookingModel.findByUser("user-1", { page: 2, limit: BOOKINGS_PER_PAGE });
      const page3 = await BookingModel.findByUser("user-1", { page: 3, limit: BOOKINGS_PER_PAGE });
      const page4 = await BookingModel.findByUser("user-1", { page: 4, limit: BOOKINGS_PER_PAGE });

      // Assert
      expect(page1.bookings).toHaveLength(BOOKINGS_PER_PAGE);
      expect(page2.bookings).toHaveLength(BOOKINGS_PER_PAGE);
      expect(page3.bookings).toHaveLength(BOOKINGS_PER_PAGE);
      expect(page4.bookings).toHaveLength(10 % BOOKINGS_PER_PAGE); // 1 remaining

      // Total should be 10
      expect(page1.total).toBe(10);
      expect(page2.total).toBe(10);
      expect(page3.total).toBe(10);
      expect(page4.total).toBe(10);
    });
  });

  describe("filtered pagination", () => {
    it("should paginate correctly with status filter", async () => {
      // Arrange: Create bookings with different statuses
      const now = new Date();

      // 3 confirmed bookings
      for (let i = 0; i < 3; i++) {
        const booking = await BookingModel.create({
          menteeId: `mentee-${i}`,
          mentorId: `mentor-${i}`,
          scheduledAt: new Date(now.getTime() + i * 86400000),
          durationMinutes: 60,
          topic: `Conf topic ${i}`,
          status: "confirmed" as const,
          amount: "100.00",
          currency: "USD",
        });
        createdIds.push(booking.id);
      }

      // 2 pending bookings
      for (let i = 0; i < 2; i++) {
        const booking = await BookingModel.create({
          menteeId: `mentee-${3+i}`,
          mentorId: `mentor-${3+i}`,
          scheduledAt: new Date(now.getTime() + (i + 3) * 86400000),
          durationMinutes: 60,
          topic: `Pending topic ${i}`,
          status: "pending" as const,
          amount: "100.00",
          currency: "USD",
        });
        createdIds.push(booking.id);
      }

      // Act: Get confirmed pages
      const page1 = await BookingModel.findByUser("user-1", { page: 1, limit: BOOKINGS_PER_PAGE, status: "confirmed" });
      const page2 = await BookingModel.findByUser("user-1", { page: 2, limit: BOOKINGS_PER_PAGE, status: "confirmed" });

      // Assert
      expect(page1.bookings).toHaveLength(3);
      expect(page2.bookings).toHaveLength(0); // All 3 confirmed bookings on page 1

      expect(page1.total).toBe(3);
      expect(page2.total).toBe(3);
    });

    it("should paginate mixed results with status filter", async () => {
      // Arrange: Create 4 confirmed and 2 pending
      const now = new Date();

      for (let i = 0; i < 4; i++) {
        const booking = await BookingModel.create({
          menteeId: `mentee-${i}`,
          mentorId: `mentor-${i}`,
          scheduledAt: new Date(now.getTime() + i * 86400000),
          durationMinutes: 60,
          topic: `Conf topic ${i}`,
          status: "confirmed" as const,
          amount: "100.00",
          currency: "USD",
        });
        createdIds.push(booking.id);
      }

      for (let i = 0; i < 2; i++) {
        const booking = await BookingModel.create({
          menteeId: `mentee-${4+i}`,
          mentorId: `mentor-${4+i}`,
          scheduledAt: new Date(now.getTime() + (i + 4) * 86400000),
          durationMinutes: 60,
          topic: `Pending topic ${i}`,
          status: "pending" as const,
          amount: "100.00",
          currency: "USD",
        });
        createdIds.push(booking.id);
      }

      // Act: Get all pages with status=confirmed filter
      const page1 = await BookingModel.findByUser("user-1", { page: 1, limit: BOOKINGS_PER_PAGE, status: "confirmed" });
      const page2 = await BookingModel.findByUser("user-1", { page: 2, limit: BOOKINGS_PER_PAGE, status: "confirmed" });
      const page3 = await BookingModel.findByUser("user-1", { page: 3, limit: BOOKINGS_PER_PAGE, status: "confirmed" });

      // Assert: 4 confirmed bookings paginated across 2 pages
      expect(page1.bookings).toHaveLength(BOOKINGS_PER_PAGE); // 3
      expect(page2.bookings).toHaveLength(1); // 1 remaining
      expect(page3.bookings).toHaveLength(0);

      expect(page1.total).toBe(4);
      expect(page2.total).toBe(4);
      expect(page3.total).toBe(4);
    });
  });
});