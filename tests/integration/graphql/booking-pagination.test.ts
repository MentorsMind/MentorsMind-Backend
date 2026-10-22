import { ApolloServer } from "@apollo/server";
import type { Request, Response } from "express";
import { BookingsService } from "../../../src/services/bookings.service";
import resolvers from "../../../src/graphql/resolvers";
import typeDefs from "../../../src/graphql/schema";
import { PaginationUtil } from "../../../src/utils/pagination.utils";
import type { GraphQLLoaders } from "../../../src/graphql/dataloaders";

jest.mock("../../../src/services/bookings.service", () => ({
  BookingsService: { getUserBookings: jest.fn() },
}));
jest.mock("../../../src/services/mentors.service", () => ({ MentorsService: {} }));
jest.mock("../../../src/services/payments.service", () => ({ PaymentsService: {} }));
jest.mock("../../../src/services/users.service", () => ({ UsersService: {} }));

describe("GraphQL booking pagination", () => {
  const server = new ApolloServer({ typeDefs, resolvers });
  const getUserBookings = jest.spyOn(BookingsService, "getUserBookings");
  const cursor = PaginationUtil.encodeCursor({
    id: "booking-1",
    created_at: "2026-10-16T12:00:00.000Z",
  });
  const contextValue = {
    req: {} as Request,
    res: {} as Response,
    user: { userId: "user-1", role: "mentee" },
    loaders: {} as GraphQLLoaders,
  };

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    getUserBookings.mockRestore();
  });

  beforeEach(() => {
    getUserBookings.mockReset();
  });

  const query = `
    query GetBookings($cursor: String) {
      bookings(cursor: $cursor, limit: 2) {
        bookings { id }
        nextCursor
        hasMore
        total
      }
    }
  `;

  it("returns a first page and its cursor when no cursor is supplied", async () => {
    getUserBookings.mockResolvedValue({
      bookings: [{ id: "booking-1" }],
      nextCursor: cursor,
      hasMore: true,
      total: 3,
    } as Awaited<ReturnType<typeof BookingsService.getUserBookings>>);

    const result = await server.executeOperation(
      { query, variables: {} },
      { contextValue },
    );

    expect(result.body.kind).toBe("single");
    if (result.body.kind !== "single") throw new Error("Expected a single GraphQL result");
    expect(result.body.singleResult.errors).toBeUndefined();
    expect(result.body.singleResult.data).toEqual({
      bookings: {
        bookings: [{ id: "booking-1" }],
        nextCursor: cursor,
        hasMore: true,
        total: 3,
      },
    });
    expect(getUserBookings).toHaveBeenCalledWith("user-1", {
      status: undefined,
      cursor: undefined,
      limit: 2,
    });
  });

  it("forwards a supplied cursor and returns the next page", async () => {
    getUserBookings.mockResolvedValue({
      bookings: [{ id: "booking-2" }],
      nextCursor: null,
      hasMore: false,
      total: 3,
    } as Awaited<ReturnType<typeof BookingsService.getUserBookings>>);

    const result = await server.executeOperation(
      { query, variables: { cursor } },
      { contextValue },
    );

    expect(result.body.kind).toBe("single");
    if (result.body.kind !== "single") throw new Error("Expected a single GraphQL result");
    expect(result.body.singleResult.errors).toBeUndefined();
    expect(result.body.singleResult.data).toEqual({
      bookings: {
        bookings: [{ id: "booking-2" }],
        nextCursor: null,
        hasMore: false,
        total: 3,
      },
    });
    expect(getUserBookings).toHaveBeenCalledWith("user-1", {
      status: undefined,
      cursor,
      limit: 2,
    });
  });
});
