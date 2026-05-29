jest.mock("../../config/db", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock("../../services/cache.service", () => ({
  CacheService: {
    wrap: jest.fn(),
    del: jest.fn(),
  },
}));

import db from "../../config/db";
import { CacheService } from "../../services/cache.service";
import { LearnerService } from "../../services/learners.service";

describe("LearnerService", () => {
  const mockDbQuery = db.query as jest.Mock;
  const mockWrap = CacheService.wrap as jest.Mock;
  const mockDel = CacheService.del as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWrap.mockImplementation(
      async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    );
  });

  it("caches session timeline responses for five minutes", async () => {
    const learnerId = "learner-123";
    const rows = [{ month: "2026-04", count: "2" }];

    mockDbQuery.mockResolvedValueOnce({ rows });

    const result = await LearnerService.getSessionTimeline(learnerId);

    expect(mockWrap).toHaveBeenCalledTimes(1);
    expect(mockWrap).toHaveBeenCalledWith(
      `learner:timeline:${learnerId}`,
      300,
      expect.any(Function),
    );
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(result).toEqual(rows);
  });

  it("invalidates progress and timeline cache keys together", async () => {
    const learnerId = "learner-456";

    await LearnerService.invalidateCache(learnerId);

    expect(mockDel).toHaveBeenCalledTimes(3);
    expect(mockDel).toHaveBeenCalledWith(`learner:progress:${learnerId}`);
    expect(mockDel).toHaveBeenCalledWith(`learner:timeline:${learnerId}`);
    expect(mockDel).toHaveBeenCalledWith(`learner:goal-timeline:${learnerId}`);
  });
});
