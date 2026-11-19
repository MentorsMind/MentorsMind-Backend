import {
  calculateRateLimit,
  getLoadBand,
  RateLimitRuleContext,
} from "../rate-limit-rules";

const baseContext: RateLimitRuleContext = {
  tier: "free",
  category: "general",
  behaviorBlockRate: 0,
  behaviorSampleSize: 0,
  load: { load1: 0.1, cpuCount: 4, memoryUtilization: 0.4 },
};

describe("rate-limit-rules", () => {
  it("gives premium users three times the category allowance", () => {
    expect(calculateRateLimit({ ...baseContext, tier: "premium" }).max).toBe(180);
  });

  it("reduces thresholds under critical system load", () => {
    const load = { load1: 1.2, cpuCount: 4, memoryUtilization: 0.5 };
    const result = calculateRateLimit({
      ...baseContext,
      load,
    });

    expect(getLoadBand(load)).toBe("critical");
    expect(result.max).toBe(36);
  });

  it("tightens limits for abusive behavior after enough samples", () => {
    const result = calculateRateLimit({
      ...baseContext,
      behaviorBlockRate: 0.6,
      behaviorSampleSize: 10,
    });

    expect(result.max).toBe(30);
  });

  it("does not react to noisy behavior samples", () => {
    const result = calculateRateLimit({
      ...baseContext,
      behaviorBlockRate: 1,
      behaviorSampleSize: 9,
    });

    expect(result.max).toBe(60);
  });
});