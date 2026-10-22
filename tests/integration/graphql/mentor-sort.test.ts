import { ApolloServer } from "@apollo/server";

jest.mock("../../../src/config/database", () => {
  const pool = { query: jest.fn() };
  return { __esModule: true, default: pool, db: pool };
});

jest.mock("../../../src/services/cache.service", () => ({
  CacheService: {
    wrap: (_key: string, _ttl: number, callback: () => Promise<unknown>) =>
      callback(),
  },
}));

jest.mock("../../../src/services/bookings.service", () => ({
  BookingsService: {},
}));
jest.mock("../../../src/services/payments.service", () => ({
  PaymentsService: {},
}));
jest.mock("../../../src/services/users.service", () => ({ UsersService: {} }));

import pool from "../../../src/config/database";
import typeDefs from "../../../src/graphql/schema";
import resolvers from "../../../src/graphql/resolvers";

describe("GraphQL mentor sorting integration", () => {
  let server: ApolloServer;

  beforeAll(async () => {
    server = new ApolloServer({ typeDefs, resolvers });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    jest.mocked(pool.query).mockImplementation(async (query: string) => {
      if (query.includes("COUNT(*)")) {
        return { rows: [{ count: "2" }] } as never;
      }

      return {
        rows: [
          {
            id: "mentor-low-rate",
            created_at: new Date("2025-01-01T00:00:00.000Z"),
            hourly_rate: 50,
          },
          {
            id: "mentor-high-rate",
            created_at: new Date("2025-01-02T00:00:00.000Z"),
            hourly_rate: 100,
          },
        ],
      } as never;
    });
  });

  afterEach(() => {
    jest.mocked(pool.query).mockReset();
  });

  it("returns mentors in hourly-rate ascending order when requested in the filter", async () => {
    const response = await server.executeOperation({
      query: `
        query {
          mentors(filter: { sortBy: HOURLY_RATE, sortOrder: ASC }) {
            edges {
              node {
                id
                hourlyRate
              }
            }
          }
        }
      `,
    });

    expect(response.body.kind).toBe("single");
    if (response.body.kind !== "single") {
      throw new Error("Expected a single GraphQL response");
    }

    expect(response.body.singleResult.errors).toBeUndefined();
    expect(response.body.singleResult.data).toMatchObject({
      mentors: {
        edges: [
          { node: { id: "mentor-low-rate", hourlyRate: 50 } },
          { node: { id: "mentor-high-rate", hourlyRate: 100 } },
        ],
      },
    });

    expect(jest.mocked(pool.query).mock.calls[0][0]).toContain(
      "ORDER BY hourly_rate ASC NULLS LAST",
    );
  });
});
