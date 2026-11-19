import {
  BusinessTier,
  calculateRateLimit,
  getLoadBand,
  getSystemLoad,
  RateLimitRule,
  RateLimitRuleContext,
  SystemLoadSnapshot,
} from "../config/rate-limit-rules";
import { RateLimiterService, EndpointCategory } from "./rate-limiter.service";
import {
  RateLimitAnalytics,
  RateLimitAnalyticsService,
} from "./rate-limit-analytics.service";

export interface IntelligentRateLimitContext {
  tier: BusinessTier;
  category: EndpointCategory;
}

export interface IntelligentRateLimitResult {
  allowed: boolean;
  current: number;
  remaining: number;
  resetTime: Date;
  limit: number;
  tier: BusinessTier;
  category: EndpointCategory;
  loadBand: ReturnType<typeof getLoadBand>;
  rule: RateLimitRule;
  analytics: RateLimitAnalytics;
}

type AnalyticsReader = Pick<typeof RateLimitAnalyticsService, "get" | "record">;

export class IntelligentRateLimiterService {
  constructor(
    private readonly analytics: AnalyticsReader = RateLimitAnalyticsService,
    private readonly loadProvider: () => SystemLoadSnapshot = getSystemLoad,
  ) {}

  async check(
    key: string,
    context: IntelligentRateLimitContext,
  ): Promise<IntelligentRateLimitResult> {
    const analytics = await this.analytics.get(key);
    const load = this.loadProvider();
    const ruleContext: RateLimitRuleContext = {
      ...context,
      behaviorBlockRate: analytics.blockRate,
      behaviorSampleSize: analytics.totalRequests,
      load,
    };
    const rule = calculateRateLimit(ruleContext);
    const result = await RateLimiterService.check(key, rule.windowMs, rule.max);
    await this.analytics.record(key, result.allowed);

    return {
      ...result,
      ...context,
      loadBand: getLoadBand(load),
      rule,
      analytics: await this.analytics.get(key),
    };
  }

  async getReport(key: string): Promise<RateLimitAnalytics> {
    return this.analytics.get(key);
  }

  async getReports(keys: string[]): Promise<RateLimitAnalytics[]> {
    return Promise.all(keys.map((key) => this.getReport(key)));
  }
}

export const intelligentRateLimiterService = new IntelligentRateLimiterService();