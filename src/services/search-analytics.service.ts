/**
 * Search Analytics Service
 * Tracks search performance and provides insights
 * Issue #872
 */

import { Logger } from "../utils/logger.utils";

export interface SearchMetrics {
  queryId: string;
  query: string;
  timestamp: number;
  resultCount: number;
  executionTimeMs: number;
  clickedResults: string[];
  clickThroughRate: number;
}

export class SearchAnalyticsService {
  private logger: Logger;
  private metricsHistory: SearchMetrics[] = [];
  private queryCache: Map<string, { count: number; avgExecutionTime: number }> = new Map();

  constructor() {
    this.logger = new Logger('SearchAnalytics');
  }

  public recordSearch(metrics: SearchMetrics): void {
    this.metricsHistory.push(metrics);
    
    // Update query cache
    const cached = this.queryCache.get(metrics.query) || { count: 0, avgExecutionTime: 0 };
    cached.count++;
    cached.avgExecutionTime = 
      (cached.avgExecutionTime * (cached.count - 1) + metrics.executionTimeMs) / cached.count;
    this.queryCache.set(metrics.query, cached);

    // Cleanup old metrics (keep last 10000)
    if (this.metricsHistory.length > 10000) {
      this.metricsHistory = this.metricsHistory.slice(-10000);
    }

    this.logger.debug(`Recorded search: ${metrics.query} (${metrics.executionTimeMs}ms, ${metrics.resultCount} results)`);
  }

  public getTopQueries(limit: number = 10): Array<{ query: string; count: number; avgTime: number }> {
    const sorted = Array.from(this.queryCache.entries())
      .map(([query, data]) => ({ query, count: data.count, avgTime: data.avgExecutionTime }))
      .sort((a, b) => b.count - a.count);
    
    return sorted.slice(0, limit);
  }

  public getAverageExecutionTime(): number {
    if (this.metricsHistory.length === 0) return 0;
    const total = this.metricsHistory.reduce((sum, m) => sum + m.executionTimeMs, 0);
    return total / this.metricsHistory.length;
  }

  public getSearchPerformanceReport(): any {
    const totalSearches = this.metricsHistory.length;
    const avgExecutionTime = this.getAverageExecutionTime();
    const avgResultCount = this.metricsHistory.reduce((sum, m) => sum + m.resultCount, 0) / totalSearches;
    const avgClickThroughRate = this.metricsHistory.reduce((sum, m) => sum + m.clickThroughRate, 0) / totalSearches;

    return {
      totalSearches,
      avgExecutionTime,
      avgResultCount,
      avgClickThroughRate,
      topQueries: this.getTopQueries(10),
      slowQueries: this.getSlowestQueries(5),
    };
  }

  private getSlowestQueries(limit: number): Array<{ query: string; executionTimeMs: number }> {
    return this.metricsHistory
      .sort((a, b) => b.executionTimeMs - a.executionTimeMs)
      .slice(0, limit)
      .map(m => ({ query: m.query, executionTimeMs: m.executionTimeMs }));
  }
}
