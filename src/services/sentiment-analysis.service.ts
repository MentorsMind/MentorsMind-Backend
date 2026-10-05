import { Logger } from "../utils/logger.utils";

export interface SentimentScore {
  positive: number;
  negative: number;
  neutral: number;
  overall: "positive" | "negative" | "neutral";
}

export interface EmotionAnalysis {
  joy: number;
  anger: number;
  sadness: number;
  fear: number;
  surprise: number;
  dominant: string;
}

export interface MeetingSentiment {
  meetingId: string;
  overallSentiment: SentimentScore;
  timelineSentiment: Array<{ timestamp: number; sentiment: SentimentScore }>;
  participantSentiments: Map<string, SentimentScore>;
  emotions: EmotionAnalysis;
}

export class SentimentAnalysisService {
  private meetingSentiments: Map<string, MeetingSentiment> = new Map();

  async analyzeSentiment(text: string): Promise<SentimentScore> {
    logger.debug("Analyzing sentiment for text");

    // Placeholder sentiment analysis
    const positive = this.calculatePositiveScore(text);
    const negative = this.calculateNegativeScore(text);
    const neutral = 1 - positive - negative;

    let overall: "positive" | "negative" | "neutral";
    if (positive > negative && positive > neutral) {
      overall = "positive";
    } else if (negative > positive && negative > neutral) {
      overall = "negative";
    } else {
      overall = "neutral";
    }

    return { positive, negative, neutral, overall };
  }

  async analyzeEmotion(text: string): Promise<EmotionAnalysis> {
    // Placeholder emotion analysis
    const emotions = {
      joy: Math.random() * 0.5,
      anger: Math.random() * 0.3,
      sadness: Math.random() * 0.2,
      fear: Math.random() * 0.1,
      surprise: Math.random() * 0.3,
    };

    const dominant = Object.entries(emotions).reduce((a, b) =>
      emotions[a[0] as keyof typeof emotions] >
      emotions[b[0] as keyof typeof emotions]
        ? a
        : b,
    )[0];

    return { ...emotions, dominant };
  }

  async trackMeetingSentiment(
    meetingId: string,
    speaker: string,
    text: string,
    timestamp: number,
  ): Promise<void> {
    let meeting = this.meetingSentiments.get(meetingId);

    if (!meeting) {
      meeting = {
        meetingId,
        overallSentiment: {
          positive: 0,
          negative: 0,
          neutral: 1,
          overall: "neutral",
        },
        timelineSentiment: [],
        participantSentiments: new Map(),
        emotions: {
          joy: 0,
          anger: 0,
          sadness: 0,
          fear: 0,
          surprise: 0,
          dominant: "neutral",
        },
      };
      this.meetingSentiments.set(meetingId, meeting);
    }

    const sentiment = await this.analyzeSentiment(text);

    // Update timeline
    meeting.timelineSentiment.push({ timestamp, sentiment });

    // Update participant sentiment
    const participantSentiment = meeting.participantSentiments.get(speaker) || {
      positive: 0,
      negative: 0,
      neutral: 1,
      overall: "neutral" as const,
    };

    participantSentiment.positive =
      (participantSentiment.positive + sentiment.positive) / 2;
    participantSentiment.negative =
      (participantSentiment.negative + sentiment.negative) / 2;
    participantSentiment.neutral =
      (participantSentiment.neutral + sentiment.neutral) / 2;

    if (
      participantSentiment.positive > participantSentiment.negative &&
      participantSentiment.positive > participantSentiment.neutral
    ) {
      participantSentiment.overall = "positive";
    } else if (
      participantSentiment.negative > participantSentiment.positive &&
      participantSentiment.negative > participantSentiment.neutral
    ) {
      participantSentiment.overall = "negative";
    } else {
      participantSentiment.overall = "neutral";
    }

    meeting.participantSentiments.set(speaker, participantSentiment);

    // Update overall sentiment
    this.updateOverallSentiment(meeting);
  }

  async getMeetingSentiment(
    meetingId: string,
  ): Promise<MeetingSentiment | null> {
    return this.meetingSentiments.get(meetingId) || null;
  }

  async getSentimentTrend(
    meetingId: string,
  ): Promise<Array<{ timestamp: number; score: number }>> {
    const meeting = this.meetingSentiments.get(meetingId);
    if (!meeting) return [];

    return meeting.timelineSentiment.map((item) => ({
      timestamp: item.timestamp,
      score: item.sentiment.positive - item.sentiment.negative,
    }));
  }

  private calculatePositiveScore(text: string): number {
    const positiveWords = [
      "good",
      "great",
      "excellent",
      "happy",
      "love",
      "amazing",
    ];
    const words = text.toLowerCase().split(/\s+/);
    const count = words.filter((word) => positiveWords.includes(word)).length;
    return Math.min((count / words.length) * 5, 1);
  }

  private calculateNegativeScore(text: string): number {
    const negativeWords = ["bad", "terrible", "hate", "angry", "sad", "awful"];
    const words = text.toLowerCase().split(/\s+/);
    const count = words.filter((word) => negativeWords.includes(word)).length;
    return Math.min((count / words.length) * 5, 1);
  }

  private updateOverallSentiment(meeting: MeetingSentiment): void {
    const sentiments = Array.from(meeting.participantSentiments.values());
    if (sentiments.length === 0) return;

    const avgPositive =
      sentiments.reduce((sum, s) => sum + s.positive, 0) / sentiments.length;
    const avgNegative =
      sentiments.reduce((sum, s) => sum + s.negative, 0) / sentiments.length;
    const avgNeutral =
      sentiments.reduce((sum, s) => sum + s.neutral, 0) / sentiments.length;

    let overall: "positive" | "negative" | "neutral";
    if (avgPositive > avgNegative && avgPositive > avgNeutral) {
      overall = "positive";
    } else if (avgNegative > avgPositive && avgNegative > avgNeutral) {
      overall = "negative";
    } else {
      overall = "neutral";
    }

    meeting.overallSentiment = {
      positive: avgPositive,
      negative: avgNegative,
      neutral: avgNeutral,
      overall,
    };
  }
}

export const sentimentAnalysisService = new SentimentAnalysisService();
