import { ApolloServer } from "@apollo/server";
import typeDefs from "../../../src/graphql/schema";
import resolvers from "../../../src/graphql/resolvers";
import { BookingsService } from "../../../src/services/bookings.service";

jest.mock("../../../src/utils/logger.utils", () => {
  const l = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
  return { logger: l, Logger: l };
});
jest.mock("../../../src/config/redis", () => ({ redisClient: {}, default: {} }));
jest.mock("../../../src/config/database", () => ({ __esModule: true, default: { query: jest.fn() }, pool: { query: jest.fn() }, db: {} }));
jest.mock("../../../src/services/bookings.service", () => ({
  BookingsService: { getUserBookings: jest.fn(), getBookingById: jest.fn() },
}));

const statuses = [
  ["PENDING", "pending"],
  ["CONFIRMED", "confirmed"],
  ["COMPLETED", "completed"],
  ["CANCELLED", "cancelled"],
  ["RESCHEDULED", "rescheduled"],
  ["NO_SHOW", "no_show"],
] as const;

describe("GraphQL booking status round-trip", () => {
  let server: ApolloServer;

  beforeAll(async () => {
    server = new ApolloServer({ typeDefs, resolvers: resolvers as any });
    await server.start();
  });
  afterAll(() => server.stop());

  it.each(statuses)("returns %s for a %s booking", async (graphqlStatus, dbStatus) => {
    (BookingsService.getUserBookings as jest.Mock).mockResolvedValue({
      bookings: [{ id: "b1", status: dbStatus, mentor_id: "m1", mentee_id: "u1", duration_minutes: 60 }],
      total: 1,
      hasMore: false,
    });

    const res = await server.executeOperation(
      { query: `query($s: BookingStatus){ bookings(status: $s){ bookings { id status } } }`, variables: { s: graphqlStatus } },
      { contextValue: { user: { userId: "u1", role: "mentee" }, loaders: {} } },
    );

    const body = res.body as any;
    expect(body.singleResult.errors).toBeUndefined();
    expect(body.singleResult.data.bookings.bookings[0].status).toBe(graphqlStatus);
    expect(BookingsService.getUserBookings).toHaveBeenLastCalledWith(
      "u1",
      expect.objectContaining({ status: dbStatus }),
    );
  });
});
