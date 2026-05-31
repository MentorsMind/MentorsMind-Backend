export interface MetricPercentile {
  value: number;
  percentile: number;
}

export interface MentorBenchmark {
  mentorId: string;
  metrics: {
    sessionRating: MetricPercentile;
    completionRate: MetricPercentile;
    responseTime: MetricPercentile;
    retentionRate: MetricPercentile;
    earningsPerSession: MetricPercentile;
  };
  overallRank: number;
  topPerformerGap: Record<string, number>;
  improvementAreas: string[];
}

/**
 * Simple benchmarking service stub.
 * Replace with aggregated DB queries and statistical computation.
 */
export class BenchmarkingService {
  async computeForMentor(mentorId: string): Promise<MentorBenchmark> {
    // Placeholder sample data
    const sample: MentorBenchmark = {
      mentorId,
      metrics: {
        sessionRating: { value: 4.7, percentile: 85 },
        completionRate: { value: 0.92, percentile: 88 },
        responseTime: { value: 120, percentile: 60 },
        retentionRate: { value: 0.45, percentile: 70 },
        earningsPerSession: { value: 35.5, percentile: 78 },
      },
      overallRank: 120,
      topPerformerGap: { sessionRating: 0.3, earningsPerSession: 10 },
      improvementAreas: ['responseTime', 'retentionRate'],
    };

    return sample;
  }
}

export default new BenchmarkingService();
