import { db } from "../../config/database";
import { CacheService } from "../cache.service";
import {
  AnalyticsService,
  AnalyticsViewsUnavailableError,
} from "../analytics.service";

jest.mock("../../config/database", () => ({
  __esModule: true,
  default: { query: jest.fn() },
  db: { query: jest.fn() },
}));

jest.mock("../cache.service", () => ({
  CacheService: {
    wrap: jest.fn(),
  },
}));

const requiredViews = [
  "mv_daily_revenue",
  "mv_daily_users",
  "mv_session_stats",
  "mv_top_mentors",
  "mv_asset_distribution",
];

describe("AnalyticsService view availability", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rechecks views before returning cached analytics", async () => {
    const cachedRevenue = [{ date: "2026-11-21" }];
    (CacheService.wrap as jest.Mock).mockResolvedValue(cachedRevenue);
    (db.query as jest.Mock)
      .mockResolvedValueOnce({
        rows: requiredViews.map((table_name) => ({ table_name })),
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(AnalyticsService.getRevenue()).resolves.toEqual(cachedRevenue);
    await expect(AnalyticsService.getRevenue()).rejects.toBeInstanceOf(
      AnalyticsViewsUnavailableError,
    );

    expect(db.query).toHaveBeenCalledTimes(2);
    expect(CacheService.wrap).toHaveBeenCalledTimes(1);
  });
});
