import { ReviewsService } from "../../src/services/reviews.service";

jest.mock("../../src/config/database", () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
  },
}));

const pool = require("../../src/config/database").default;

function mockClient(bookingRow: any | null) {
  const query = jest.fn(async (sql: string, params?: any[]) => {
    if (sql.includes("FROM bookings")) {
      return { rows: bookingRow ? [bookingRow] : [] };
    }
    if (sql.includes("FROM reviews WHERE booking_id")) {
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO reviews")) {
      return {
        rows: [
          {
            id: "r1",
            booking_id: params?.[0],
            reviewer_id: params?.[1],
            reviewee_id: params?.[2],
            rating: params?.[3],
            comment: params?.[4] ?? null,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const client = { query, release: jest.fn() };
  (pool.connect as jest.Mock).mockResolvedValue(client);
  return client;
}

describe("ReviewsService.createReview booking ownership (issue #1302)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows a legitimate mentee review", async () => {
    mockClient({ id: "b1", mentor_id: "mentor-1", mentee_id: "mentee-1" });
    const review = await ReviewsService.createReview("mentee-1", {
      session_id: "b1",
      rating: 5,
    } as any);
    expect(review.reviewer_id).toBe("mentee-1");
  });

  it("rejects a non-participant review with 403", async () => {
    mockClient({ id: "b1", mentor_id: "mentor-1", mentee_id: "mentee-1" });
    await expect(
      ReviewsService.createReview("attacker", {
        session_id: "b1",
        rating: 1,
      } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
