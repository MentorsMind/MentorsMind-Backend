import { SessionModel } from "../session.model";
import pool from "../../config/database";

jest.mock("../../utils/logger.utils", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
  Logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../config/redis", () => ({ redisClient: {}, default: {} }));
jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  db: {},
  pool: { query: jest.fn() },
}));

describe("session no_show status", () => {
  beforeEach(() => jest.clearAllMocks());

  it("SessionModel.updateStatus accepts no_show", async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: "s1", status: "no_show" }] });
    const result = await SessionModel.updateStatus("s1", "no_show");
    expect(result?.status).toBe("no_show");
    expect((pool.query as jest.Mock).mock.calls[0][1]).toContain("no_show");
  });
});
