import { Pool } from "pg";
import { Logger } from "../utils/logger.utils";

export interface Assessment {
  id: string;
  userId: string;
  skillCategory: string;
  level: "beginner" | "intermediate" | "advanced" | "expert";
  score: number;
  completedAt: Date;
  questions: AssessmentQuestion[];
  feedback: string;
}

export interface AssessmentQuestion {
  id: string;
  question: string;
  type: "multiple_choice" | "coding" | "scenario";
  difficulty: number;
  answer?: string;
  correct: boolean;
  timeSpent: number;
}

export interface SkillGap {
  skill: string;
  currentLevel: number;
  targetLevel: number;
  gap: number;
  recommendations: string[];
}

export class SkillAssessmentService {
  constructor(private pool: Pool) {}

  async createAssessment(
    userId: string,
    skillCategory: string,
  ): Promise<Assessment> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const questions = await this.generateAdaptiveQuestions(
        skillCategory,
        "intermediate",
      );

      const result = await client.query(
        `INSERT INTO assessments (user_id, skill_category, status, created_at)
         VALUES ($1, $2, 'in_progress', NOW())
         RETURNING id`,
        [userId, skillCategory],
      );

      const assessmentId = result.rows[0].id;

      for (const question of questions) {
        await client.query(
          `INSERT INTO assessment_questions (assessment_id, question_text, question_type, difficulty, options)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            assessmentId,
            question.question,
            question.type,
            question.difficulty,
            JSON.stringify(question.options || []),
          ],
        );
      }

      await client.query("COMMIT");

      logger.info(
        { userId, assessmentId, skillCategory },
        "Created skill assessment",
      );

      return {
        id: assessmentId,
        userId,
        skillCategory,
        level: "intermediate",
        score: 0,
        completedAt: new Date(),
        questions,
        feedback: "",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error(
        { error, userId, skillCategory },
        "Failed to create assessment",
      );
      throw error;
    } finally {
      client.release();
    }
  }

  async submitAnswer(
    assessmentId: string,
    questionId: string,
    answer: string,
  ): Promise<{ correct: boolean; feedback: string }> {
    const client = await this.pool.connect();
    try {
      const questionResult = await client.query(
        `SELECT correct_answer, explanation FROM assessment_questions WHERE id = $1`,
        [questionId],
      );

      if (questionResult.rows.length === 0) {
        throw new Error("Question not found");
      }

      const { correct_answer, explanation } = questionResult.rows[0];
      const correct = answer === correct_answer;

      await client.query(
        `INSERT INTO assessment_answers (assessment_id, question_id, user_answer, is_correct, submitted_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [assessmentId, questionId, answer, correct],
      );

      logger.info({ assessmentId, questionId, correct }, "Answer submitted");

      return {
        correct,
        feedback: correct
          ? "Correct!"
          : explanation || "Incorrect. Please review the material.",
      };
    } catch (error) {
      logger.error(
        { error, assessmentId, questionId },
        "Failed to submit answer",
      );
      throw error;
    } finally {
      client.release();
    }
  }

  async completeAssessment(assessmentId: string): Promise<Assessment> {
    const client = await this.pool.connect();
    try {
      const answersResult = await client.query(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct
         FROM assessment_answers WHERE assessment_id = $1`,
        [assessmentId],
      );

      const { total, correct } = answersResult.rows[0];
      const score = total > 0 ? (correct / total) * 100 : 0;
      const level = this.determineLevel(score);

      await client.query(
        `UPDATE assessments SET status = 'completed', score = $1, level = $2, completed_at = NOW()
         WHERE id = $3`,
        [score, level, assessmentId],
      );

      const assessmentResult = await client.query(
        `SELECT * FROM assessments WHERE id = $1`,
        [assessmentId],
      );

      const assessment = assessmentResult.rows[0];

      logger.info({ assessmentId, score, level }, "Assessment completed");

      return {
        id: assessmentId,
        userId: assessment.user_id,
        skillCategory: assessment.skill_category,
        level,
        score,
        completedAt: new Date(),
        questions: [],
        feedback: this.generateFeedback(score, level),
      };
    } catch (error) {
      logger.error({ error, assessmentId }, "Failed to complete assessment");
      throw error;
    } finally {
      client.release();
    }
  }

  async analyzeSkillGaps(
    userId: string,
    targetRole: string,
  ): Promise<SkillGap[]> {
    const client = await this.pool.connect();
    try {
      const userSkillsResult = await client.query(
        `SELECT skill_category, AVG(score) as avg_score
         FROM assessments
         WHERE user_id = $1 AND status = 'completed'
         GROUP BY skill_category`,
        [userId],
      );

      const roleRequirementsResult = await client.query(
        `SELECT skill, required_level FROM role_requirements WHERE role = $1`,
        [targetRole],
      );

      const gaps: SkillGap[] = [];

      for (const requirement of roleRequirementsResult.rows) {
        const userSkill = userSkillsResult.rows.find(
          (s) => s.skill_category === requirement.skill,
        );
        const currentLevel = userSkill
          ? this.scoreToLevel(userSkill.avg_score)
          : 0;
        const targetLevel = requirement.required_level;

        if (currentLevel < targetLevel) {
          gaps.push({
            skill: requirement.skill,
            currentLevel,
            targetLevel,
            gap: targetLevel - currentLevel,
            recommendations: await this.getSkillRecommendations(
              requirement.skill,
              currentLevel,
              targetLevel,
            ),
          });
        }
      }

      logger.info(
        { userId, targetRole, gapsFound: gaps.length },
        "Skill gaps analyzed",
      );

      return gaps;
    } catch (error) {
      logger.error(
        { error, userId, targetRole },
        "Failed to analyze skill gaps",
      );
      throw error;
    } finally {
      client.release();
    }
  }

  private async generateAdaptiveQuestions(
    skillCategory: string,
    level: string,
  ): Promise<AssessmentQuestion[]> {
    // Placeholder implementation - would generate questions based on skill and level
    return [
      {
        id: "1",
        question: "Sample question for " + skillCategory,
        type: "multiple_choice",
        difficulty: 5,
        correct: false,
        timeSpent: 0,
      },
    ];
  }

  private determineLevel(
    score: number,
  ): "beginner" | "intermediate" | "advanced" | "expert" {
    if (score >= 90) return "expert";
    if (score >= 75) return "advanced";
    if (score >= 50) return "intermediate";
    return "beginner";
  }

  private scoreToLevel(score: number): number {
    if (score >= 90) return 4;
    if (score >= 75) return 3;
    if (score >= 50) return 2;
    return 1;
  }

  private generateFeedback(score: number, level: string): string {
    if (score >= 90) {
      return "Excellent! You have expert-level knowledge in this area.";
    } else if (score >= 75) {
      return "Great job! You have advanced understanding. Consider taking on more complex challenges.";
    } else if (score >= 50) {
      return "Good start! You have intermediate knowledge. Practice more to advance.";
    } else {
      return "Keep learning! Focus on fundamentals to build a strong foundation.";
    }
  }

  private async getSkillRecommendations(
    skill: string,
    currentLevel: number,
    targetLevel: number,
  ): Promise<string[]> {
    // Placeholder implementation - would fetch personalized recommendations
    return [
      `Take intermediate ${skill} course`,
      `Practice ${skill} projects`,
      `Join ${skill} community`,
    ];
  }
}
