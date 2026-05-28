import pool from "../config/database";
import { CacheService } from "./cache.service";
import { logger } from "../utils/logger";

export interface RevenueForecast {
  date: string;
  predictedRevenue: number;
  confidenceIntervalLower: number;
  confidenceIntervalUpper: number;
  currency: string;
}

export interface DemandForecast {
  date: string;
  timeSlot: string;
  predictedDemand: number;
  availableCapacity: number;
  utilizationRate: number;
}

export interface TimeSeriesData {
  date: Date;
  value: number;
}

// Simple linear regression implementation
class LinearRegression {
  static forecast(data: TimeSeriesData[], periodsAhead: number): Array<{
    date: Date;
    value: number;
    confidence: [number, number];
  }> {
    if (data.length < 2) {
      throw new Error('Insufficient data for forecasting');
    }

    // Convert to numeric arrays
    const x = data.map((_, i) => i);
    const y = data.map(d => d.value);

    // Calculate linear regression
    const n = data.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared for confidence
    const yMean = sumY / n;
    const ssRes = y.reduce((sum, yi, i) => {
      const predicted = slope * x[i] + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);

    // Generate predictions
    const predictions = [];
    const lastDate = data[data.length - 1].date;
    
    for (let i = 1; i <= periodsAhead; i++) {
      const xValue = n - 1 + i;
      const predicted = slope * xValue + intercept;
      
      // Calculate confidence interval (±15% for 85% accuracy target)
      const margin = Math.abs(predicted) * 0.15 * (1 - rSquared);
      
      const forecastDate = new Date(lastDate);
      forecastDate.setDate(forecastDate.getDate() + i);
      
      predictions.push({
        date: forecastDate,
        value: Math.max(0, predicted), // Ensure non-negative
        confidence: [
          Math.max(0, predicted - margin),
          predicted + margin
        ] as [number, number]
      });
    }

    return predictions;
  }

  static calculateAccuracy(predictions: number[], actuals: number[]): number {
    if (predictions.length !== actuals.length || predictions.length === 0) {
      return 0;
    }

    const errors = predictions.map((p, i) => {
      const actual = actuals[i];
      return actual !== 0 ? Math.abs(p - actual) / actual : 0;
    });

    const mape = errors.reduce((sum, e) => sum + e, 0) / errors.length;
    return Math.max(0, 1 - mape); // Convert MAPE to accuracy
  }
}

export const PredictiveEngineService = {
  /**
   * Generate revenue forecast using time series analysis
   */
  async forecastRevenue(months: number, currency?: string): Promise<RevenueForecast[]> {
    const cacheKey = `analytics:predictions:revenue:${currency || 'all'}:${months}`;
    
    return CacheService.wrap(cacheKey, 86400, async () => { // 24 hour cache
      try {
        logger.info('Generating revenue forecast', { months, currency });

        // Get historical revenue data
        const query = `
          SELECT 
            date,
            currency,
            total_amount as value
          FROM mv_revenue_time_series
          WHERE date >= CURRENT_DATE - INTERVAL '1 year'
            ${currency ? 'AND currency = $1' : ''}
          ORDER BY date ASC
        `;

        const params = currency ? [currency] : [];
        const { rows } = await pool.query(query, params);

        if (rows.length < 30) { // Need at least 30 days of data
          throw new Error('Insufficient historical data for revenue forecasting');
        }

        // Group by currency if not specified
        const currencyGroups = currency ? 
          { [currency]: rows } : 
          this.groupByCurrency(rows);

        const forecasts: RevenueForecast[] = [];

        for (const [curr, data] of Object.entries(currencyGroups)) {
          // Prepare time series data
          const timeSeriesData: TimeSeriesData[] = data.map(row => ({
            date: new Date(row.date),
            value: parseFloat(row.value || '0')
          }));

          // Generate forecast for the number of months requested
          const daysToForecast = months * 30; // Approximate days per month
          const predictions = LinearRegression.forecast(timeSeriesData, daysToForecast);

          // Convert to monthly aggregates
          const monthlyForecasts = this.aggregateToMonthly(predictions, curr);
          forecasts.push(...monthlyForecasts);
        }

        // Store predictions in database
        await this.storePredictions('revenue_forecast', forecasts);

        logger.info('Revenue forecast generated successfully', { 
          months, 
          currency, 
          forecastCount: forecasts.length 
        });

        return forecasts;
      } catch (error) {
        logger.error('Failed to generate revenue forecast', { error, months, currency });
        throw error;
      }
    });
  },

  /**
   * Predict session demand by time slot
   */
  async forecastDemand(days: number): Promise<DemandForecast[]> {
    const cacheKey = `analytics:predictions:demand:${days}`;
    
    return CacheService.wrap(cacheKey, 86400, async () => { // 24 hour cache
      try {
        logger.info('Generating demand forecast', { days });

        // Get historical hourly demand data
        const query = `
          SELECT 
            hour,
            day_of_week,
            hour_of_day,
            booking_count,
            active_mentors
          FROM mv_hourly_session_demand
          WHERE hour >= CURRENT_TIMESTAMP - INTERVAL '90 days'
          ORDER BY hour ASC
        `;

        const { rows } = await pool.query(query);

        if (rows.length < 168) { // Need at least 1 week of hourly data
          throw new Error('Insufficient historical data for demand forecasting');
        }

        // Group by day of week and hour
        const demandPatterns = this.analyzeDemandPatterns(rows);
        
        // Generate forecasts for the requested days
        const forecasts: DemandForecast[] = [];
        const startDate = new Date();
        
        for (let i = 0; i < days; i++) {
          const forecastDate = new Date(startDate);
          forecastDate.setDate(forecastDate.getDate() + i);
          
          const dayOfWeek = forecastDate.getDay();
          
          // Generate hourly forecasts for this day
          for (let hour = 0; hour < 24; hour++) {
            const pattern = demandPatterns[dayOfWeek]?.[hour];
            
            if (pattern) {
              const predictedDemand = Math.round(pattern.avgDemand);
              const availableCapacity = Math.round(pattern.avgCapacity * 1.2); // 20% buffer
              
              forecasts.push({
                date: forecastDate.toISOString().split('T')[0],
                timeSlot: `${hour.toString().padStart(2, '0')}:00`,
                predictedDemand,
                availableCapacity,
                utilizationRate: Math.min(100, (predictedDemand / availableCapacity) * 100)
              });
            }
          }
        }

        // Store predictions in database
        await this.storePredictions('demand_forecast', forecasts);

        logger.info('Demand forecast generated successfully', { 
          days, 
          forecastCount: forecasts.length 
        });

        return forecasts;
      } catch (error) {
        logger.error('Failed to generate demand forecast', { error, days });
        throw error;
      }
    });
  },
  /**
   * Calculate forecast accuracy
   */
  async calculateAccuracy(
    predictionType: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    try {
      // Get stored predictions for the period
      const predictionsQuery = `
        SELECT target_date, predicted_value
        FROM analytics_predictions
        WHERE prediction_type = $1
          AND target_date >= $2
          AND target_date <= $3
        ORDER BY target_date
      `;

      const { rows: predictions } = await pool.query(predictionsQuery, [
        predictionType,
        startDate,
        endDate
      ]);

      if (predictions.length === 0) {
        return 0;
      }

      // Get actual values for comparison
      let actualsQuery = '';
      if (predictionType === 'revenue_forecast') {
        actualsQuery = `
          SELECT date, SUM(total_amount) as actual_value
          FROM mv_daily_revenue
          WHERE date >= $1 AND date <= $2
          GROUP BY date
          ORDER BY date
        `;
      } else if (predictionType === 'demand_forecast') {
        actualsQuery = `
          SELECT DATE(hour) as date, SUM(booking_count) as actual_value
          FROM mv_hourly_session_demand
          WHERE DATE(hour) >= $1 AND DATE(hour) <= $2
          GROUP BY DATE(hour)
          ORDER BY DATE(hour)
        `;
      }

      const { rows: actuals } = await pool.query(actualsQuery, [startDate, endDate]);

      // Match predictions with actuals
      const matchedData = this.matchPredictionsWithActuals(predictions, actuals);
      
      if (matchedData.length === 0) {
        return 0;
      }

      // Calculate accuracy using MAPE
      const predictedValues = matchedData.map(d => d.predicted);
      const actualValues = matchedData.map(d => d.actual);
      
      const accuracy = LinearRegression.calculateAccuracy(predictedValues, actualValues);
      
      logger.debug('Forecast accuracy calculated', {
        predictionType,
        accuracy,
        dataPoints: matchedData.length
      });

      return accuracy;
    } catch (error) {
      logger.error('Failed to calculate forecast accuracy', { error, predictionType });
      return 0;
    }
  },

  /**
   * Train prediction models (background job)
   */
  async trainModels(): Promise<void> {
    try {
      logger.info('Starting prediction model training');

      // Train revenue forecasting model
      await this.forecastRevenue(3); // 3 months ahead
      
      // Train demand forecasting model
      await this.forecastDemand(30); // 30 days ahead

      // Calculate and store accuracy metrics
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // Last 30 days

      const revenueAccuracy = await this.calculateAccuracy('revenue_forecast', startDate, endDate);
      const demandAccuracy = await this.calculateAccuracy('demand_forecast', startDate, endDate);

      // Store accuracy metrics
      await CacheService.set('analytics:predictions:accuracy', {
        revenue: revenueAccuracy,
        demand: demandAccuracy,
        lastUpdated: new Date().toISOString()
      }, 86400);

      logger.info('Prediction model training completed', {
        revenueAccuracy,
        demandAccuracy
      });
    } catch (error) {
      logger.error('Failed to train prediction models', { error });
      throw error;
    }
  },

  // Helper methods
  groupByCurrency(rows: any[]): Record<string, any[]> {
    return rows.reduce((groups, row) => {
      const currency = row.currency || 'XLM';
      if (!groups[currency]) {
        groups[currency] = [];
      }
      groups[currency].push(row);
      return groups;
    }, {});
  },

  aggregateToMonthly(predictions: any[], currency: string): RevenueForecast[] {
    const monthlyData: Record<string, { total: number; count: number; confidence: [number, number] }> = {};

    predictions.forEach(pred => {
      const monthKey = pred.date.toISOString().substring(0, 7); // YYYY-MM
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { 
          total: 0, 
          count: 0, 
          confidence: [0, 0] 
        };
      }
      
      monthlyData[monthKey].total += pred.value;
      monthlyData[monthKey].count += 1;
      monthlyData[monthKey].confidence[0] += pred.confidence[0];
      monthlyData[monthKey].confidence[1] += pred.confidence[1];
    });

    return Object.entries(monthlyData).map(([month, data]) => ({
      date: `${month}-01`,
      predictedRevenue: data.total,
      confidenceIntervalLower: data.confidence[0],
      confidenceIntervalUpper: data.confidence[1],
      currency
    }));
  },

  analyzeDemandPatterns(rows: any[]): Record<number, Record<number, { avgDemand: number; avgCapacity: number }>> {
    const patterns: Record<number, Record<number, { demands: number[]; capacities: number[] }>> = {};

    // Group by day of week and hour
    rows.forEach(row => {
      const dayOfWeek = parseInt(row.day_of_week);
      const hourOfDay = parseInt(row.hour_of_day);
      
      if (!patterns[dayOfWeek]) {
        patterns[dayOfWeek] = {};
      }
      
      if (!patterns[dayOfWeek][hourOfDay]) {
        patterns[dayOfWeek][hourOfDay] = { demands: [], capacities: [] };
      }
      
      patterns[dayOfWeek][hourOfDay].demands.push(parseInt(row.booking_count || 0));
      patterns[dayOfWeek][hourOfDay].capacities.push(parseInt(row.active_mentors || 0));
    });

    // Calculate averages
    const avgPatterns: Record<number, Record<number, { avgDemand: number; avgCapacity: number }>> = {};
    
    Object.entries(patterns).forEach(([day, hours]) => {
      avgPatterns[parseInt(day)] = {};
      
      Object.entries(hours).forEach(([hour, data]) => {
        const avgDemand = data.demands.reduce((a, b) => a + b, 0) / data.demands.length;
        const avgCapacity = data.capacities.reduce((a, b) => a + b, 0) / data.capacities.length;
        
        avgPatterns[parseInt(day)][parseInt(hour)] = {
          avgDemand,
          avgCapacity
        };
      });
    });

    return avgPatterns;
  },

  matchPredictionsWithActuals(predictions: any[], actuals: any[]): Array<{ predicted: number; actual: number }> {
    const matched = [];
    
    for (const pred of predictions) {
      const actual = actuals.find(a => 
        new Date(a.date).toDateString() === new Date(pred.target_date).toDateString()
      );
      
      if (actual) {
        matched.push({
          predicted: parseFloat(pred.predicted_value),
          actual: parseFloat(actual.actual_value)
        });
      }
    }
    
    return matched;
  },

  async storePredictions(type: string, predictions: any[]): Promise<void> {
    try {
      // Clear existing predictions of this type for future dates
      await pool.query(`
        DELETE FROM analytics_predictions 
        WHERE prediction_type = $1 AND target_date >= CURRENT_DATE
      `, [type]);

      // Insert new predictions
      for (const pred of predictions) {
        await pool.query(`
          INSERT INTO analytics_predictions (
            prediction_type, target_date, predicted_value, 
            confidence_interval_lower, confidence_interval_upper, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (prediction_type, target_date) 
          DO UPDATE SET 
            predicted_value = EXCLUDED.predicted_value,
            confidence_interval_lower = EXCLUDED.confidence_interval_lower,
            confidence_interval_upper = EXCLUDED.confidence_interval_upper,
            metadata = EXCLUDED.metadata,
            updated_at = CURRENT_TIMESTAMP
        `, [
          type,
          pred.date,
          type === 'revenue_forecast' ? pred.predictedRevenue : pred.predictedDemand,
          type === 'revenue_forecast' ? pred.confidenceIntervalLower : pred.predictedDemand * 0.85,
          type === 'revenue_forecast' ? pred.confidenceIntervalUpper : pred.predictedDemand * 1.15,
          JSON.stringify(pred)
        ]);
      }

      logger.debug('Predictions stored successfully', { type, count: predictions.length });
    } catch (error) {
      logger.error('Failed to store predictions', { error, type });
      throw error;
    }
  }
};