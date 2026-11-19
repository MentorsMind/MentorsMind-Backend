import { UsersService } from "../../services/users.service";
import { db } from "../../config/database";
import { LoyaltyService } from "../../services/loyalty.service";
import { CacheService } from "../../services/cache.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn(), connect: jest.fn() },
  db: { query: jest.fn(), connect: jest.fn() },
}));

jest.mock("../../services/loyalty.service", () => ({
  LoyaltyService: { getOrCreateAccount: jest.fn() },
}));

jest.mock("../../services/cache.service", () => ({
  CacheService: { wrap: jest.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()) },
}));

const queryMock = db.query as jest.Mock;
const loyaltyMock = LoyaltyService.getOrCreateAccount as jest.Mock;

describe("UsersService.getUserStats (#1301)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loyaltyMock.mockResolvedValue({ tier: "silver" });
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: "12" }] }) // totalSessions
      .mockResolvedValueOnce({ rows: [{ count: "2" }] }) // upcomingSessions
      .mockResolvedValueOnce({ rows: [{ avg: "4.5" }] }) // averageRatingGiven
      .mockResolvedValueOnce({ rows: [{ total: "350.00", count: "8" }] }) // totalSpent
      .mockResolvedValueOnce({ rows: [] }); // streak: no sessions
  });

  it("returns the dashboard shape with parallel queries", async () => {
    const stats = await UsersService.getUserStats("user-1");

    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(stats).toEqual({
      totalSessions: 12,
      upcomingSessions: 2,
      averageRatingGiven: 4.5,
      totalSpent: 350,
      loyaltyTier: "silver",
      streakDays: null,
    });
  });

  it("returns null for stats a new user has not accumulated", async () => {
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [{ avg: null }] })
      .mockResolvedValueOnce({ rows: [{ total: "0", count: "0" }] })
      .mockResolvedValueOnce({ rows: [] });
    loyaltyMock.mockResolvedValue({ tier: "bronze" });

    const stats = await UsersService.getUserStats("new-user");

    expect(stats.averageRatingGiven).toBeNull();
    expect(stats.totalSpent).toBeNull();
    expect(stats.streakDays).toBeNull();
    expect(stats.loyaltyTier).toBe("bronze");
  });

  it("caches per-user with the userStats key", async () => {
    await UsersService.getUserStats("user-1");
    expect(CacheService.wrap).toHaveBeenCalledWith(
      "mm:user:user-1:stats",
      expect.any(Number),
      expect.any(Function),
    );
  });
});
