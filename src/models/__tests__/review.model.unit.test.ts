import { ReviewModel } from "../review.model";
import { db } from "../../config/database";

jest.mock("../../config/database", () => ({
  db: {
    query: jest.fn(),
  },
}));

const mockedQuery = db.query as unknown as jest.Mock;

describe("ReviewModel (issue #1286)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("findByMentorId returns empty array for a new mentor", async () => {
    mockedQuery.mockResolvedValue({ rows: [] });

    const result = await ReviewModel.findByMentorId("mentor-new");

    expect(result).toEqual([]);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("reviewee_id"),
      ["mentor-new"],
    );
  });

  it("calculateAverageRating returns null when mentor has no reviews", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ average: null }] });

    await expect(
      ReviewModel.calculateAverageRating("mentor-new"),
    ).resolves.toBeNull();
  });

  it("calculateAverageRating parses Postgres AVG string to float", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ average: "4.666666666666667" }] });

    const avg = await ReviewModel.calculateAverageRating("mentor-1");

    expect(avg).toBeCloseTo(4.6667, 4);
  });

  it("calculateAverageRating handles single and all-5-star reviews", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ average: "5" }] });
    await expect(ReviewModel.calculateAverageRating("m1")).resolves.toBe(5);

    mockedQuery.mockResolvedValueOnce({ rows: [{ average: "1" }] });
    await expect(ReviewModel.calculateAverageRating("m2")).resolves.toBe(1);
  });

  it("create persists all fields and returns the row", async () => {
    const row = {
      id: "rev-1",
      booking_id: "book-1",
      reviewer_id: "user-1",
      reviewee_id: "mentor-1",
      rating: 5,
    };
    mockedQuery.mockResolvedValue({ rows: [row] });

    const result = await ReviewModel.create({
      bookingId: "book-1",
      reviewerId: "user-1",
      revieweeId: "mentor-1",
      rating: 5,
      comment: "Great session",
    });

    expect(result).toEqual(row);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO reviews"),
      expect.arrayContaining(["book-1", "user-1", "mentor-1", 5]),
    );
  });
});
