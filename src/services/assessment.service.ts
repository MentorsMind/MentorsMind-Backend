import {
  AssessmentModel,
  Assessment,
  AssessmentResult,
  Answer,
  Question,
} from "../models/assessment.model";

export interface CreateAssessmentPayload {
  title: string;
  skill: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  questions: Question[];
  time_limit?: number;
  passing_score?: number;
  adaptive_enabled?: boolean;
  created_by: string;
}

export interface SubmitAssessmentPayload {
  user_id: string;
  assessment_id: string;
  answers: { questionId: string; selectedOption: number }[];
}

function computeSkillLevel(score: number): number {
  if (score >= 90) return 5;
  if (score >= 75) return 4;
  if (score >= 60) return 3;
  if (score >= 40) return 2;
  return 1;
}

function generateRecommendations(
  score: number,
  skill: string,
  difficulty: string,
): string[] {
  const recs: string[] = [];
  if (score < 50) recs.push(`Review foundational ${skill} concepts`);
  if (score < 75) recs.push(`Practice ${difficulty}-level ${skill} exercises`);
  if (score >= 75) recs.push(`Advance to next difficulty level in ${skill}`);
  if (score >= 90) recs.push(`Consider mentoring others in ${skill}`);
  return recs;
}

export const AssessmentService = {
  async createAssessment(
    payload: CreateAssessmentPayload,
  ): Promise<Assessment> {
    return AssessmentModel.create({
      ...payload,
      time_limit: payload.time_limit ?? 30,
      passing_score: payload.passing_score ?? 70,
      adaptive_enabled: payload.adaptive_enabled ?? false,
    });
  },

  async getAssessment(id: string): Promise<Assessment> {
    const assessment = await AssessmentModel.findById(id);
    if (!assessment) throw new Error("Assessment not found");
    return assessment;
  },

  async listAssessments(
    skill?: string,
    difficulty?: string,
  ): Promise<Assessment[]> {
    return AssessmentModel.findAll(skill, difficulty);
  },

  async submitAssessment(
    payload: SubmitAssessmentPayload,
  ): Promise<AssessmentResult> {
    const assessment = await AssessmentModel.findById(payload.assessment_id);
    if (!assessment) throw new Error("Assessment not found");

    const questions: Question[] = assessment.questions;
    let totalPoints = 0;
    let earnedPoints = 0;

    const gradedAnswers: Answer[] = payload.answers.map((ans) => {
      const question = questions.find((q) => q.id === ans.questionId);
      if (!question)
        return {
          questionId: ans.questionId,
          selectedOption: ans.selectedOption,
          isCorrect: false,
        };
      totalPoints += question.points;
      const isCorrect = question.correctAnswer === ans.selectedOption;
      if (isCorrect) earnedPoints += question.points;
      return {
        questionId: ans.questionId,
        selectedOption: ans.selectedOption,
        isCorrect,
      };
    });

    const score =
      totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const passed = score >= assessment.passing_score;
    const skillLevel = computeSkillLevel(score);
    const recommendations = generateRecommendations(
      score,
      assessment.skill,
      assessment.difficulty,
    );

    return AssessmentModel.saveResult({
      user_id: payload.user_id,
      assessment_id: payload.assessment_id,
      score,
      passed,
      answers: gradedAnswers,
      skill_level: skillLevel,
      recommendations,
      completed_at: new Date(),
    });
  },

  async getUserResults(userId: string): Promise<AssessmentResult[]> {
    return AssessmentModel.findResultsByUser(userId);
  },
};
