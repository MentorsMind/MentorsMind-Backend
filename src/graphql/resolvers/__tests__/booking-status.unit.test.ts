import resolvers from "../index";
import { BookingsService } from "../../../services/bookings.service";

jest.mock("../../../services/bookings.service", () => ({
  BookingsService: {
    getUserBookings: jest.fn(),
  },
}));

const bookingStatuses = [
  ["PENDING", "pending"],
  ["CONFIRMED", "confirmed"],
  ["COMPLETED", "completed"],
  ["CANCELLED", "cancelled"],
  ["RESCHEDULED", "rescheduled"],
  ["NO_SHOW", "no_show"],
] as const;

describe("GraphQL booking status mapping", () => {
  beforeEach(() => {
    jest.mocked(BookingsService.getUserBookings).mockResolvedValue({
      bookings: [],
      total: 0,
    });
  });

  it.each(bookingStatuses)("maps booking status pair %s/%s to GraphQL", (graphqlStatus, databaseStatus) => {
    expect((resolvers.Booking as any).status({ status: databaseStatus })).toBe(
      graphqlStatus,
    );
  });

  it.each(bookingStatuses)("maps GraphQL filter %s to database status %s", async (graphqlStatus, databaseStatus) => {
    const context = {
      user: { userId: "user-1", role: "mentee" },
    } as any;

    await (resolvers.Query as any).bookings(
      null,
      { status: graphqlStatus },
      context,
    );

    expect(BookingsService.getUserBookings).toHaveBeenCalledWith("user-1", {
      status: databaseStatus,
      cursor: undefined,
      limit: undefined,
    });
    jest.mocked(BookingsService.getUserBookings).mockClear();
  });

  it("returns the booking service result for a NO_SHOW filter", async () => {
    const noShowBooking = { id: "booking-1", status: "no_show" };
    const result = { bookings: [noShowBooking], total: 1 };
    jest.mocked(BookingsService.getUserBookings).mockResolvedValue(result as any);

    const response = await (resolvers.Query as any).bookings(
      null,
      { status: "NO_SHOW" },
      { user: { userId: "user-1", role: "mentee" } },
    );

    expect(BookingsService.getUserBookings).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ status: "no_show" }),
    );
    expect(response).toBe(result);
  });
});