import {
  createReviewSchema,
  updateReviewSchema,
} from "../reviews.validator";

// Application-level guard for #1097: out-of-range ratings are rejected before
// any service or DB call, complementing the reviews.rating CHECK constraint.
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("reviews.validator rating bounds", () => {
  it.each([1, 3, 5])("accepts rating %i on create", (rating) => {
    const result = createReviewSchema.safeParse({
      body: { session_id: SESSION_ID, rating },
    });
    expect(result.success).toBe(true);
  });

  it.each([0, 6, -1, 4.5])("rejects rating %p on create", (rating) => {
    const result = createReviewSchema.safeParse({
      body: { session_id: SESSION_ID, rating },
    });
    expect(result.success).toBe(false);
  });

  it("reports the max-bound message for rating 6", () => {
    const result = createReviewSchema.safeParse({
      body: { session_id: SESSION_ID, rating: 6 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Rating must be at most 5");
  });

  it.each([0, 6])("rejects rating %i on update", (rating) => {
    const result = updateReviewSchema.safeParse({ body: { rating } });
    expect(result.success).toBe(false);
  });
});
