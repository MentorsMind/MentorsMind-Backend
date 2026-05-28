import pool from "../config/database";
import { logger } from "../utils/logger";
import { AdvancedAnalyticsService, Insight } from "./advanced-analytics.service";

export interface TrendInsight {
  type: 'trend';
  direction: 'up' | 'down' | 'stable';
  magnitude: number;
  significance: 'low' | 'medium' | 'high';
}

export interface AnomalyInsight {
  type: 'anomaly';
  deviation: number;
  expectedValue: number;
  actualValue: number;
}

export interface RecommendationInsight {
  type: 'recommendation';
  category: 'performance' | 'growth' | 'efficiency';
  priority: 'low' | 'medium' | 'high';
  actionItems: string[];
}

export const InsightGeneratorService = {
  /**
   * Analyze metrics and generate insights
   */
  async generateInsights(): Promise<Insight[]> {
    try {
      logger.info('Starting insight generation');
      
      const insights: Insight[] = [];
      
      // Get current metrics
      const metrics = await AdvancedAnalyticsService.getMetrics('admin', '30d');
      
      // Generate different types of insights
      const trendInsights = await this.detectTrends('revenue', []);
      const anomalyInsights = await this.detectAnomalies('sessions', []);
      const recommendations = await this.generateRecommendations(metrics);
      
      insights.push(...trendInsights, ...anomalyInsights, ...recommendations);
      
      // Store insights in database
      await this.storeInsights(insights);
      
      logger.info('Insight generation completed', { count: insights.length });
      return insights;
    } catch (error) {
      logger.error('Failed to generate insights', { error });
      throw error;
    }
  },

  /**
   * Detect trends in time series data
   */
  async detectTrends(metricName: string, data: any[]): Promise<Insight[]> {
    try {
      // Get revenue trend data
      const query = `
        SELECT date, SUM(total_amount) as value
        FROM mv_daily_revenue
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY date
        ORDER BY date
      `;
      
      const { rows } = await pool.query(query);
      
      if (rows.length < 7) return [];
      
      // Calculate trend
      const values = rows.map(r => parseFloat(r.value || '0'));
      const trend = this.calculateTrend(values);
      
      const insights: Insight[] = [];
      
      if (Math.abs(trend.slope) > 0.1) { // Significant trend
        insights.push({
          id: `trend_${metricName}_${Date.now()}`,
          type: 'trend',
          severity: trend.slope > 0.2 ? 'info' : trend.slope < -0.2 ? 'warning' : 'info',
          title: `${metricName} Trend Detected`,
          description: `${metricName} is ${trend.slope > 0 ? 'increasing' : 'decreasing'} by ${Math.abs(trend.slope * 100).toFixed(1)}% over the last 30 days`,
          metricName,
          metricValue: trend.slope,
          createdAt: new Date().toISOString(),
          isRead: false
        });
      }
      
      return insights;
    } catch (error) {
      logger.error('Failed to detect trends', { error, metricName });
      return [];
    }
  },

  /**
   * Detect anomalies using statistical methods
   */
  async detectAnomalies(metricName: string, data: any[]): Promise<Insight[]> {
    try {
      // Get session completion rate data
      const query = `
        SELECT 
          date,
          CASE 
            WHEN SUM(session_count) > 0 THEN 
              SUM(session_count) FILTER (WHERE status = 'completed')::float / SUM(session_count) * 100
            ELSE 0 
          END as completion_rate
        FROM mv_session_stats
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY date
        ORDER BY date
      `;
      
      const { rows } = await pool.query(query);
      
      if (rows.length < 7) return [];
      
      const values = rows.map(r => parseFloat(r.completion_rate || '0'));
      const anomalies = this.detectStatisticalAnomalies(values);
      
      const insights: Insight[] = [];
      
      if (anomalies.length > 0) {
        const latestAnomaly = anomalies[anomalies.length - 1];
        
        insights.push({
          id: `anomaly_${metricName}_${Date.now()}`,
          type: 'anomaly',
          severity: Math.abs(latestAnomaly.deviation) > 2 ? 'critical' : 'warning',
          title: `${metricName} Anomaly Detected`,
          description: `${metricName} completion rate is ${latestAnomaly.deviation > 0 ? 'unusually high' : 'unusually low'} (${latestAnomaly.value.toFixed(1)}% vs expected ${latestAnomaly.expected.toFixed(1)}%)`,
          metricName,
          metricValue: latestAnomaly.value,
          createdAt: new Date().toISOString(),
          isRead: false
        });
      }
      
      return insights;
    } catch (error) {
      logger.error('Failed to detect anomalies', { error, metricName });
      return [];
    }
  },

  /**
   * Generate actionable recommendations
   */
  async generateRecommendations(metrics: any): Promise<Insight[]> {
    const recommendations: Insight[] = [];
    
    try {
      // Revenue recommendations
      if (metrics.revenue.growthRate < 0) {
        recommendations.push({
          id: `rec_revenue_${Date.now()}`,
          type: 'recommendation',
          severity: 'warning',
          title: 'Revenue Decline Detected',
          description: 'Consider implementing promotional campaigns or reviewing pricing strategy to boost revenue',
          metricName: 'revenue_growth',
          metricValue: metrics.revenue.growthRate,
          createdAt: new Date().toISOString(),
          isRead: false
        });
      }
      
      // Session recommendations
      if (metrics.sessions.completionRate < 80) {
        recommendations.push({
          id: `rec_sessions_${Date.now()}`,
          type: 'recommendation',
          severity: 'info',
          title: 'Session Completion Rate Below Target',
          description: 'Focus on mentor training and session quality improvements to increase completion rates',
          metricName: 'completion_rate',
          metricValue: metrics.sessions.completionRate,
          createdAt: new Date().toISOString(),
          isRead: false
        });
      }
      
      // Growth recommendations
      if (metrics.growth.userGrowthRate < 5) {
        recommendations.push({
          id: `rec_growth_${Date.now()}`,
          type: 'recommendation',
          severity: 'info',
          title: 'User Growth Opportunity',
          description: 'Consider expanding marketing efforts or referral programs to accelerate user acquisition',
          metricName: 'user_growth',
          metricValue: metrics.growth.userGrowthRate,
          createdAt: new Date().toISOString(),
          isRead: false
        });
      }
      
      return recommendations;
    } catch (error) {
      logger.error('Failed to generate recommendations', { error });
      return [];
    }
  },

  /**
   * Get insights for user
   */
  async getInsights(userId: string, unreadOnly: boolean = false): Promise<Insight[]> {
    try {
      const query = `
        SELECT *
        FROM analytics_insights
        WHERE 1=1
          ${unreadOnly ? 'AND is_read = false' : ''}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      
      const { rows } = await pool.query(query);
      
      return rows.map(row => ({
        id: row.id,
        type: row.insight_type,
        severity: row.severity,
        title: row.title,
        description: row.description,
        metricName: row.metric_name,
        metricValue: parseFloat(row.metric_value || '0'),
        createdAt: row.created_at,
        isRead: row.is_read
      }));
    } catch (error) {
      logger.error('Failed to get insights', { error, userId });
      return [];
    }
  },

  /**
   * Mark insight as read
   */
  async markAsRead(insightId: string): Promise<void> {
    try {
      await pool.query(
        'UPDATE analytics_insights SET is_read = true WHERE id = $1',
        [insightId]
      );
    } catch (error) {
      logger.error('Failed to mark insight as read', { error, insightId });
      throw error;
    }
  },

  // Helper methods
  calculateTrend(values: number[]): { slope: number; correlation: number } {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    // Calculate correlation coefficient
    const meanX = sumX / n;
    const meanY = sumY / n;
    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
    const denomX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0));
    const denomY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0));
    const correlation = numerator / (denomX * denomY);
    
    return { slope, correlation };
  },

  detectStatisticalAnomalies(values: number[]): Array<{ index: number; value: number; expected: number; deviation: number }> {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    const anomalies = [];
    
    values.forEach((value, index) => {
      const deviation = (value - mean) / stdDev;
      
      if (Math.abs(deviation) > 2) { // 2 standard deviations
        anomalies.push({
          index,
          value,
          expected: mean,
          deviation
        });
      }
    });
    
    return anomalies;
  },

  async storeInsights(insights: Insight[]): Promise<void> {
    try {
      for (const insight of insights) {
        await pool.query(`
          INSERT INTO analytics_insights (
            id, insight_type, severity, title, description, 
            metric_name, metric_value, is_read, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO NOTHING
        `, [
          insight.id,
          insight.type,
          insight.severity,
          insight.title,
          insight.description,
          insight.metricName,
          insight.metricValue,
          insight.isRead,
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
        ]);
      }
    } catch (error) {
      logger.error('Failed to store insights', { error });
      throw error;
    }
  }
};