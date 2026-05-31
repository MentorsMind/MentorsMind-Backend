export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskFactor {
  name: string;
  weight: number;
  details?: string;
}

export interface Intervention {
  type: 'email' | 'discount' | 'outreach' | 'feature-highlight';
  priority: number;
  expectedImpact: number;
  content: string;
  scheduledAt: Date;
}

export interface ChurnPrediction {
  userId: string;
  churnProbability: number;
  riskLevel: RiskLevel;
  riskFactors: RiskFactor[];
  predictedChurnDate?: Date;
  recommendedInterventions: Intervention[];
}

/**
 * Lightweight churn prediction service stub.
 * Replace heuristic logic with real ML integration later.
 */
export class ChurnPredictionService {
  async predictForUser(userId: string): Promise<ChurnPrediction> {
    // Placeholder heuristic: random probability for now
    const churnProbability = Math.min(1, Math.random());
    const riskLevel: RiskLevel = churnProbability > 0.85 ? 'critical' : churnProbability > 0.6 ? 'high' : churnProbability > 0.3 ? 'medium' : 'low';

    const result: ChurnPrediction = {
      userId,
      churnProbability,
      riskLevel,
      riskFactors: [
        { name: 'inactivity', weight: 0.5, details: 'No sessions in last 30 days' },
      ],
      recommendedInterventions: [
        {
          type: 'email',
          priority: 1,
          expectedImpact: 0.2,
          content: 'We miss you — here is a personalized offer',
          scheduledAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      ],
    };

    return result;
  }
}

export default new ChurnPredictionService();
