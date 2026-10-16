import { SessionModel, SESSION_STATUSES } from "../session.model";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  db: { query: jest.fn() },
}));

const pool = require("../../config/database").default;

describe("SessionModel.updateStatus validation (issue #1304)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects invalid status before the DB is called", async () => {
    await expect(SessionModel.updateStatus("id-1", "hacked")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("exposes the expected status list", () => {
    expect([...SESSION_STATUSES]).toEqual([
      "scheduled",
      "active",
      "paused",
      "completed",
      "cancelled",
      "no_show",
    ]);
  });
});
