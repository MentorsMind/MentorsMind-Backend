/**
 * Personality Assessment Service
 * Evaluates personality compatibility for mentor-mentee matching
 * Issue #874
 */

import { Logger } from "../utils/logger.utils";

export interface PersonalityTraits {
  openness: number; // 0-100
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  communicationStyle: 'direct' | 'indirect' | 'collaborative' | 'analytical';
  learningStyle: 'visual' | 'auditory' | 'kinesthetic' | 'reading';
}

export class PersonalityAssessmentService {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('PersonalityAssessment');
  }

  public assessCompatibility(mentorTraits: PersonalityTraits, menteeTraits: PersonalityTraits): number {
    if (!mentorTraits || !menteeTraits) {
      this.logger.warn('Missing personality traits for compatibility assessment');
      return 0.5; // Neutral score if data is missing
    }

    // Big Five personality compatibility
    const bigFiveScore = this.calculateBigFiveCompatibility(mentorTraits, menteeTraits);

    // Communication style compatibility
    const communicationScore = this.assessCommunicationCompatibility(
      mentorTraits.communicationStyle,
      menteeTraits.communicationStyle
    );

    // Learning style alignment
    const learningScore = this.assessLearningStyleAlignment(
      mentorTraits.learningStyle,
      menteeTraits.learningStyle
    );

    // Weighted average
    const totalScore = bigFiveScore * 0.5 + communicationScore * 0.3 + learningScore * 0.2;

    this.logger.debug(`Personality compatibility: ${totalScore.toFixed(2)} (BigFive: ${bigFiveScore.toFixed(2)}, Comm: ${communicationScore.toFixed(2)}, Learning: ${learningScore.toFixed(2)})`);

    return totalScore;
  }

  private calculateBigFiveCompatibility(mentor: PersonalityTraits, mentee: PersonalityTraits): number {
    // Calculate compatibility for each trait
    const opennessCompat = this.calculateTraitCompatibility(mentor.openness, mentee.openness, 'high-align');
    const conscientiousnessCompat = this.calculateTraitCompatibility(mentor.conscientiousness, mentee.conscientiousness, 'high-align');
    const extraversionCompat = this.calculateTraitCompatibility(mentor.extraversion, mentee.extraversion, 'complement');
    const agreeablenessCompat = this.calculateTraitCompatibility(mentor.agreeableness, mentee.agreeableness, 'high-align');
    const neuroticismCompat = this.calculateTraitCompatibility(mentor.neuroticism, mentee.neuroticism, 'low-mentor');

    // Average the trait compatibilities
    return (opennessCompat + conscientiousnessCompat + extraversionCompat + agreeablenessCompat + neuroticismCompat) / 5;
  }

  private calculateTraitCompatibility(
    mentorValue: number,
    menteeValue: number,
    strategy: 'high-align' | 'complement' | 'low-mentor'
  ): number {
    const diff = Math.abs(mentorValue - menteeValue);

    switch (strategy) {
      case 'high-align':
        // Both should have high values and be similar
        if (mentorValue > 60 && menteeValue > 60 && diff < 20) return 1.0;
        if (mentorValue > 50 && menteeValue > 50 && diff < 30) return 0.8;
        return Math.max(0, 1 - diff / 100);

      case 'complement':
        // Some difference is good (e.g., introvert mentor with extrovert mentee can work)
        if (diff > 20 && diff < 40) return 1.0;
        if (diff < 20) return 0.8;
        return Math.max(0, 1 - Math.abs(diff - 30) / 70);

      case 'low-mentor':
        // Mentor should have lower value (e.g., low neuroticism is better for mentors)
        if (mentorValue < menteeValue && mentorValue < 40) return 1.0;
        if (mentorValue < menteeValue) return 0.8;
        if (mentorValue < 50) return 0.6;
        return 0.4;

      default:
        return 0.5;
    }
  }

  private assessCommunicationCompatibility(
    mentorStyle: PersonalityTraits['communicationStyle'],
    menteeStyle: PersonalityTraits['communicationStyle']
  ): number {
    // Compatibility matrix for communication styles
    const compatibilityMatrix: { [key: string]: { [key: string]: number } } = {
      direct: { direct: 0.9, indirect: 0.5, collaborative: 0.7, analytical: 0.8 },
      indirect: { direct: 0.5, indirect: 0.9, collaborative: 0.8, analytical: 0.6 },
      collaborative: { direct: 0.7, indirect: 0.8, collaborative: 1.0, analytical: 0.7 },
      analytical: { direct: 0.8, indirect: 0.6, collaborative: 0.7, analytical: 0.9 },
    };

    return compatibilityMatrix[mentorStyle]?.[menteeStyle] || 0.5;
  }

  private assessLearningStyleAlignment(
    mentorStyle: PersonalityTraits['learningStyle'],
    menteeStyle: PersonalityTraits['learningStyle']
  ): number {
    // Mentors who can adapt to mentee's learning style score higher
    // Exact match is good, but versatility is also valued
    
    if (mentorStyle === menteeStyle) {
      return 1.0; // Perfect match
    }

    // Some styles complement each other better
    const complementaryPairs: { [key: string]: string[] } = {
      visual: ['reading', 'kinesthetic'],
      auditory: ['visual', 'reading'],
      kinesthetic: ['visual', 'auditory'],
      reading: ['visual', 'auditory'],
    };

    if (complementaryPairs[mentorStyle]?.includes(menteeStyle)) {
      return 0.7; // Good complementary fit
    }

    return 0.5; // Neutral - can work with effort
  }

  public generatePersonalityInsights(traits: PersonalityTraits): string[] {
    const insights: string[] = [];

    if (traits.openness > 70) {
      insights.push('Highly open to new experiences and ideas');
    }
    if (traits.conscientiousness > 70) {
      insights.push('Very organized and detail-oriented');
    }
    if (traits.extraversion > 70) {
      insights.push('Energized by social interaction');
    } else if (traits.extraversion < 30) {
      insights.push('Prefers quieter, more focused interactions');
    }
    if (traits.agreeableness > 70) {
      insights.push('Highly cooperative and supportive');
    }
    if (traits.neuroticism < 30) {
      insights.push('Emotionally stable and resilient');
    }

    insights.push(`Prefers ${traits.communicationStyle} communication style`);
    insights.push(`${traits.learningStyle.charAt(0).toUpperCase() + traits.learningStyle.slice(1)} learner`);

    return insights;
  }
}
