/**
 * AI-Powered Matching Service
 * Machine learning-based mentor-mentee matching algorithm
 * Issue #874
 */

import { Logger } from "../utils/logger.utils";
import { SkillAnalyzerService } from './skill-analyzer.service';
import { PersonalityAssessmentService } from './personality-assessment.service';

export interface MatchingProfile {
  id: string;
  role: 'mentor' | 'mentee';
  skills: string[];
  interests: string[];
  availability: {
    daysOfWeek: string[];
    timeSlots: string[];
  };
  goals: string[];
  experience: number;
  personalityTraits: any;
}

export interface MatchScore {
  mentorId: string;
  menteeId: string;
  totalScore: number;
  breakdown: {
    skillMatch: number;
    personalityMatch: number;
    availabilityMatch: number;
    goalAlignment: number;
    experienceBalance: number;
  };
  confidence: number;
}

export class AIMatchingService {
  private logger: Logger;
  private skillAnalyzer: SkillAnalyzerService;
  private personalityAssessment: PersonalityAssessmentService;
  private matchHistory: Map<string, MatchScore[]> = new Map();

  constructor() {
    this.logger = new Logger('AIMatching');
    this.skillAnalyzer = new SkillAnalyzerService();
    this.personalityAssessment = new PersonalityAssessmentService();
  }

  public async findMatches(
    mentee: MatchingProfile,
    mentors: MatchingProfile[],
    topN: number = 5
  ): Promise<MatchScore[]> {
    this.logger.info(`Finding matches for mentee ${mentee.id} from ${mentors.length} mentors`);

    const scores: MatchScore[] = [];

    for (const mentor of mentors) {
      const score = await this.calculateMatchScore(mentor, mentee);
      scores.push(score);
    }

    // Sort by total score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    const topMatches = scores.slice(0, topN);
    this.matchHistory.set(mentee.id, topMatches);

    this.logger.info(`Found ${topMatches.length} top matches for mentee ${mentee.id}`);
    return topMatches;
  }

  private async calculateMatchScore(mentor: MatchingProfile, mentee: MatchingProfile): Promise<MatchScore> {
    // Skill matching (30% weight)
    const skillMatch = this.calculateSkillMatch(mentor.skills, mentee.skills, mentee.goals);

    // Personality compatibility (25% weight)
    const personalityMatch = this.personalityAssessment.assessCompatibility(
      mentor.personalityTraits,
      mentee.personalityTraits
    );

    // Availability alignment (20% weight)
    const availabilityMatch = this.calculateAvailabilityMatch(
      mentor.availability,
      mentee.availability
    );

    // Goal alignment (15% weight)
    const goalAlignment = this.calculateGoalAlignment(mentor.skills, mentee.goals);

    // Experience balance (10% weight)
    const experienceBalance = this.calculateExperienceBalance(mentor.experience, mentee.experience);

    // Calculate weighted total score
    const totalScore =
      skillMatch * 0.3 +
      personalityMatch * 0.25 +
      availabilityMatch * 0.2 +
      goalAlignment * 0.15 +
      experienceBalance * 0.1;

    // Calculate confidence based on data completeness
    const confidence = this.calculateConfidence(mentor, mentee);

    return {
      mentorId: mentor.id,
      menteeId: mentee.id,
      totalScore,
      breakdown: {
        skillMatch,
        personalityMatch,
        availabilityMatch,
        goalAlignment,
        experienceBalance,
      },
      confidence,
    };
  }

  private calculateSkillMatch(mentorSkills: string[], menteeSkills: string[], menteeGoals: string[]): number {
    // Skills the mentee wants to learn but doesn't have
    const skillGap = menteeGoals.filter(goal => !menteeSkills.includes(goal));
    
    // How many of those skills does the mentor have?
    const matchedSkills = skillGap.filter(skill => mentorSkills.includes(skill));
    
    if (skillGap.length === 0) return 0.5; // No clear learning goals
    
    const matchRatio = matchedSkills.length / skillGap.length;
    
    // Bonus for complementary skills
    const complementaryBonus = this.skillAnalyzer.analyzeSkillGap(mentorSkills, menteeSkills);
    
    return Math.min((matchRatio * 0.7 + complementaryBonus * 0.3), 1.0);
  }

  private calculateAvailabilityMatch(
    mentorAvailability: MatchingProfile['availability'],
    menteeAvailability: MatchingProfile['availability']
  ): number {
    const commonDays = mentorAvailability.daysOfWeek.filter(day =>
      menteeAvailability.daysOfWeek.includes(day)
    );

    const commonTimeSlots = mentorAvailability.timeSlots.filter(slot =>
      menteeAvailability.timeSlots.includes(slot)
    );

    if (commonDays.length === 0 || commonTimeSlots.length === 0) {
      return 0;
    }

    const dayMatch = commonDays.length / Math.max(
      mentorAvailability.daysOfWeek.length,
      menteeAvailability.daysOfWeek.length
    );

    const timeMatch = commonTimeSlots.length / Math.max(
      mentorAvailability.timeSlots.length,
      menteeAvailability.timeSlots.length
    );

    return (dayMatch + timeMatch) / 2;
  }

  private calculateGoalAlignment(mentorSkills: string[], menteeGoals: string[]): number {
    if (menteeGoals.length === 0) return 0.5;

    const alignedGoals = menteeGoals.filter(goal =>
      mentorSkills.some(skill => skill.toLowerCase().includes(goal.toLowerCase()) ||
                                goal.toLowerCase().includes(skill.toLowerCase()))
    );

    return alignedGoals.length / menteeGoals.length;
  }

  private calculateExperienceBalance(mentorExperience: number, menteeExperience: number): number {
    // Ideal: mentor has 2-5x more experience than mentee
    const experienceRatio = mentorExperience / (menteeExperience + 1);

    if (experienceRatio >= 2 && experienceRatio <= 5) {
      return 1.0; // Optimal range
    } else if (experienceRatio >= 1.5 && experienceRatio < 2) {
      return 0.8; // Good but not ideal
    } else if (experienceRatio > 5 && experienceRatio <= 10) {
      return 0.7; // Mentor may be over-qualified
    } else if (experienceRatio >= 1 && experienceRatio < 1.5) {
      return 0.5; // Minimal experience gap
    } else {
      return 0.2; // Poor balance
    }
  }

  private calculateConfidence(mentor: MatchingProfile, mentee: MatchingProfile): number {
    let score = 0;
    let maxScore = 0;

    // Check completeness of profiles
    const fields = ['skills', 'interests', 'availability', 'goals', 'personalityTraits'];
    
    for (const field of fields) {
      maxScore += 2; // 1 for mentor, 1 for mentee
      
      if (mentor[field] && this.isFieldComplete(mentor[field])) score++;
      if (mentee[field] && this.isFieldComplete(mentee[field])) score++;
    }

    return score / maxScore;
  }

  private isFieldComplete(field: any): boolean {
    if (Array.isArray(field)) return field.length > 0;
    if (typeof field === 'object') return Object.keys(field).length > 0;
    return !!field;
  }

  public async predictSuccessRate(match: MatchScore): Promise<number> {
    // ML-based success prediction (simplified)
    // In production, this would use a trained model
    
    const baseSuccess = match.totalScore * 0.6;
    const confidenceBonus = match.confidence * 0.2;
    const historyBonus = this.getHistoricalSuccessRate(match.mentorId) * 0.2;

    return Math.min(baseSuccess + confidenceBonus + historyBonus, 1.0);
  }

  private getHistoricalSuccessRate(mentorId: string): number {
    // Would query historical match success data
    return 0.75; // Default moderate success rate
  }

  public adjustMatchingCriteria(feedback: { matchId: string; successful: boolean; reasons: string[] }): void {
    // Dynamic adjustment based on feedback
    this.logger.info(`Adjusting matching criteria based on feedback for match ${feedback.matchId}`);
    
    // In production, this would update ML model weights
    // For now, log the feedback for future model training
  }
}
