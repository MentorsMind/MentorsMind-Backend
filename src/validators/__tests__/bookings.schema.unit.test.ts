import { createBookingSchema } from "../schemas/bookings.schemas";

describe("createBookingSchema scheduledAt", () => {
  const baseBody = {
    mentorId: "550e8400-e29b-41d4-a716-446655440000",
    durationMinutes: 60,
    topic: "Career planning",
  };

  it("rejects a past date with the 30-minute validation message", () => {
    const result = createBookingSchema.safeParse({
      body: { ...baseBody, scheduledAt: new Date(Date.now() - 1000).toISOString() },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("scheduledAt must be at least 30 minutes in the future");
    }
  });

  it("rejects 29 minutes and accepts 31 minutes in the future", () => {
    const rejected = createBookingSchema.safeParse({
      body: { ...baseBody, scheduledAt: new Date(Date.now() + 29 * 60 * 1000).toISOString() },
    });
    const accepted = createBookingSchema.safeParse({
      body: { ...baseBody, scheduledAt: new Date(Date.now() + 31 * 60 * 1000).toISOString() },
    });

    expect(rejected.success).toBe(false);
    expect(accepted.success).toBe(true);
  });
});
