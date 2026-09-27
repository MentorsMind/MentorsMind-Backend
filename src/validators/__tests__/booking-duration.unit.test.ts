import { createBookingSchema } from '../schemas/bookings.schemas';

describe('createBookingSchema duration increments', () => {
  const durationSchema = createBookingSchema.shape.body.shape.durationMinutes;

  it.each([15, 30, 60, 480])('accepts %i minutes', (durationMinutes) => {
    expect(durationSchema.safeParse(durationMinutes).success).toBe(true);
  });

  it.each([17, 33, 481])('rejects %i minutes', (durationMinutes) => {
    expect(durationSchema.safeParse(durationMinutes).success).toBe(false);
  });
});
