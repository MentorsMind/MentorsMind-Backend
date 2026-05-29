import { updatePoolMetrics } from "../pool-monitor.utils";
import { getPoolStats } from "../database.utils";

jest.mock("../database.utils", () => ({
  getPoolStats: jest.fn(),
}));

describe("pool-monitor.utils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates metrics from pool stats without throwing", () => {
    (getPoolStats as jest.Mock).mockReturnValue({
      totalCount: 18,
      idleCount: 2,
      waitingCount: 0,
    });

    expect(() => updatePoolMetrics()).not.toThrow();
    expect(getPoolStats).toHaveBeenCalled();
  });

  it("logs exhaustion when clients are waiting", () => {
    (getPoolStats as jest.Mock).mockReturnValue({
      totalCount: 20,
      idleCount: 0,
      waitingCount: 3,
    });

    expect(() => updatePoolMetrics()).not.toThrow();
  });
});
