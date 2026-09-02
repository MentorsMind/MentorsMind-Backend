import {
  calculateTwoProportionZTest,
  normalCdf,
} from '../dynamic-pricing.service';

describe('Dynamic Pricing Statistical Significance Engine', () => {
  describe('normalCdf', () => {
    it('returns 0.5 for z = 0', () => {
      expect(normalCdf(0)).toBe(0.5);
    });

    it('approximates standard normal CDF correctly for known z scores', () => {
      // z = 1.96 -> ~0.975 (two-tailed 95%)
      const cdf196 = normalCdf(1.96);
      expect(cdf196).toBeGreaterThan(0.974);
      expect(cdf196).toBeLessThan(0.976);

      // z = -1.96 -> ~0.025
      const cdfNeg196 = normalCdf(-1.96);
      expect(cdfNeg196).toBeGreaterThan(0.024);
      expect(cdfNeg196).toBeLessThan(0.026);
    });
  });

  describe('calculateTwoProportionZTest', () => {
    it('returns default metrics when sample size is 0', () => {
      const result = calculateTwoProportionZTest(0, 0, 0, 0);
      expect(result.isSignificant).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.winner).toBeNull();
      expect(result.minimumSampleSizeMet).toBe(false);
    });

    it('calculates significant lift when variant outperforms control with high confidence', () => {
      // Control: 5 conversions out of 100 impressions (5% rate)
      // Variant: 20 conversions out of 100 impressions (20% rate)
      const result = calculateTwoProportionZTest(5, 100, 20, 100);

      expect(result.controlRate).toBe(0.05);
      expect(result.variantRate).toBe(0.2);
      expect(result.conversionLift).toBe(300); // (0.20 - 0.05) / 0.05 = +300%
      expect(result.absoluteLift).toBe(0.15);
      expect(result.zScore).toBeGreaterThan(3.0);
      expect(result.pValue).toBeLessThan(0.01);
      expect(result.confidence).toBeGreaterThan(99);
      expect(result.isSignificant).toBe(true);
      expect(result.minimumSampleSizeMet).toBe(true);
      expect(result.winner).toBe('variant');
      expect(result.recommendedAction).toContain('Adopt variant pricing');
      expect(result.confidenceInterval.lower).toBeGreaterThan(0);
    });

    it('identifies significant drop when variant underperforms control', () => {
      // Control: 20 conversions out of 100 impressions (20% rate)
      // Variant: 5 conversions out of 100 impressions (5% rate)
      const result = calculateTwoProportionZTest(20, 100, 5, 100);

      expect(result.controlRate).toBe(0.2);
      expect(result.variantRate).toBe(0.05);
      expect(result.conversionLift).toBe(-75); // (0.05 - 0.20) / 0.20 = -75%
      expect(result.zScore).toBeLessThan(-3.0);
      expect(result.confidence).toBeGreaterThan(99);
      expect(result.isSignificant).toBe(true);
      expect(result.winner).toBe('control');
      expect(result.recommendedAction).toContain('Retain control pricing');
    });

    it('marks test as not significant and gathering data when sample size is below minimum', () => {
      // Small sample size (< 30)
      const result = calculateTwoProportionZTest(2, 10, 5, 10, 0.95, 30);

      expect(result.minimumSampleSizeMet).toBe(false);
      expect(result.isSignificant).toBe(false);
      expect(result.winner).toBeNull();
      expect(result.recommendedAction).toContain('Gathering data');
    });

    it('identifies inconclusive experiments when large sample size shows no statistical difference', () => {
      // 25 conversions out of 250 (10%) vs 26 conversions out of 250 (10.4%)
      const result = calculateTwoProportionZTest(25, 250, 26, 250);

      expect(result.minimumSampleSizeMet).toBe(true);
      expect(result.isSignificant).toBe(false);
      expect(result.pValue).toBeGreaterThan(0.3);
      expect(result.winner).toBe('inconclusive');
      expect(result.recommendedAction).toContain('Conclude experiment');
    });
  });
});
