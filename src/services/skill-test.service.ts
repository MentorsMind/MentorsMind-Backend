import pool from "../config/database";
import { logger } from "../utils/logger.utils";
import { createError } from "../middleware/errorHandler";
import {
  SkillTest,
  TestAttempt,
  TestQuestion,
  SubmitTestAnswersData
} from "../models/certification.model";
import { CertificationService } from "./certification.service";

/**
 * Skill Test Service
 * Manages skill verification tests for mentor certifications
 */
export const SkillTestService = {
  /**
   * Get skill test by certification type
   */
  async getTestByCertificationType(certificationTypeId: string): Promise<SkillTest | null> {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM skill_tests 
         WHERE certification_type_id = $1 AND is_active = true
         LIMIT 1`,
        [certificationTypeId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformSkillTest(rows[0]);
    } catch (error) {
      logger.error("Failed to get skill test", {
        certificationTypeId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Start a new test attempt
   */
  async startTestAttempt(
    mentorId: string,
    skillTestId: string,
    certificationId?: string
  ): Promise<TestAttempt> {
    try {
      // Verify test exists
      const { rows: testRows } = await pool.query(
        'SELECT * FROM skill_tests WHERE id = $1 AND is_active = true',
        [skillTestId]
      );

      if (testRows.length === 0) {
        throw createError("Skill test not found", 404);
      }

      const test = this.transformSkillTest(testRows[0]);

      // Check for existing in-progress attempt
      const { rows: existingRows } = await pool.query(
        `SELECT id FROM test_attempts 
         WHERE mentor_id = $1 AND skill_test_id = $2 AND status = 'in_progress'`,
        [mentorId, skillTestId]
      );

      if (existingRows.length > 0) {
        throw createError("Test attempt already in progress", 409);
      }

      // Create new attempt
      const { rows } = await pool.query(
        `INSERT INTO test_attempts 
         (mentor_id, skill_test_id, certification_id, status)
         VALUES ($1, $2, $3, 'in_progress')
         RETURNING *`,
        [mentorId, skillTestId, certificationId || null]
      );

      logger.info("Test attempt started", {
        attemptId: rows[0].id,
        mentorId,
        skillTestId
      });

      return this.transformTestAttempt(rows[0]);
    } catch (error) {
      logger.error("Failed to start test attempt", {
        mentorId,
        skillTestId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get test attempt by ID
   */
  async getTestAttempt(attemptId: string): Promise<TestAttempt | null> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM test_attempts WHERE id = $1',
        [attemptId]
      );

      if (rows.length === 0) {
        return null;
      }

      return this.transformTestAttempt(rows[0]);
    } catch (error) {
      logger.error("Failed to get test attempt", {
        attemptId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Submit test answers and calculate score
   */
  async submitTestAnswers(data: SubmitTestAnswersData): Promise<TestAttempt> {
    try {
      const attempt = await this.getTestAttempt(data.attemptId);
      if (!attempt) {
        throw createError("Test attempt not found", 404);
      }

      if (attempt.status !== 'in_progress') {
        throw createError("Test attempt is not in progress", 400);
      }

      // Get the test
      const { rows: testRows } = await pool.query(
        'SELECT * FROM skill_tests WHERE id = $1',
        [attempt.skillTestId]
      );

      if (testRows.length === 0) {
        throw createError("Skill test not found", 404);
      }

      const test = this.transformSkillTest(testRows[0]);

      // Calculate score
      const { score, totalPoints } = this.calculateScore(test.questions, data.answers);
      const percentageScore = (score / totalPoints) * 100;
      const passed = percentageScore >= test.passingScore;

      // Calculate time spent
      const timeSpentMinutes = Math.round(
        (Date.now() - new Date(attempt.startedAt).getTime()) / (1000 * 60)
      );

      // Update attempt
      const { rows } = await pool.query(
        `UPDATE test_attempts 
         SET status = 'completed',
             score = $1,
             passed = $2,
             answers = $3,
             completed_at = CURRENT_TIMESTAMP,
             time_spent_minutes = $4
         WHERE id = $5
         RETURNING *`,
        [percentageScore, passed, JSON.stringify(data.answers), timeSpentMinutes, data.attemptId]
      );

      // If passed and linked to certification, update certification
      if (passed && attempt.certificationId) {
        await CertificationService.updateCertification(
          attempt.certificationId,
          {
            status: 'verified',
            score: percentageScore,
            metadata: {
              testAttemptId: data.attemptId,
              testScore: percentageScore,
              testPassedAt: new Date().toISOString()
            }
          }
        );
      }

      logger.info("Test answers submitted", {
        attemptId: data.attemptId,
        score: percentageScore,
        passed
      });

      return this.transformTestAttempt(rows[0]);
    } catch (error) {
      logger.error("Failed to submit test answers", {
        attemptId: data.attemptId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get mentor test attempts
   */
  async getMentorTestAttempts(
    mentorId: string,
    skillTestId?: string
  ): Promise<TestAttempt[]> {
    try {
      let query = 'SELECT * FROM test_attempts WHERE mentor_id = $1';
      const params: any[] = [mentorId];

      if (skillTestId) {
        query += ' AND skill_test_id = $2';
        params.push(skillTestId);
      }

      query += ' ORDER BY started_at DESC';

      const { rows } = await pool.query(query, params);

      return rows.map(row => this.transformTestAttempt(row));
    } catch (error) {
      logger.error("Failed to get mentor test attempts", {
        mentorId,
        skillTestId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Abandon a test attempt
   */
  async abandonTestAttempt(attemptId: string): Promise<void> {
    try {
      const attempt = await this.getTestAttempt(attemptId);
      if (!attempt) {
        throw createError("Test attempt not found", 404);
      }

      if (attempt.status !== 'in_progress') {
        throw createError("Test attempt is not in progress", 400);
      }

      await pool.query(
        `UPDATE test_attempts 
         SET status = 'abandoned'
         WHERE id = $1`,
        [attemptId]
      );

      logger.info("Test attempt abandoned", { attemptId });
    } catch (error) {
      logger.error("Failed to abandon test attempt", {
        attemptId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  /**
   * Get test questions (without answers for active attempts)
   */
  async getTestQuestions(
    skillTestId: string,
    includeAnswers: boolean = false
  ): Promise<TestQuestion[]> {
    try {
      const { rows } = await pool.query(
        'SELECT questions FROM skill_tests WHERE id = $1 AND is_active = true',
        [skillTestId]
      );

      if (rows.length === 0) {
        throw createError("Skill test not found", 404);
      }

      const questions: TestQuestion[] = rows[0].questions;

      if (!includeAnswers) {
        // Remove correct answers for active test taking
        return questions.map(q => ({
          ...q,
          correctAnswer: undefined,
          explanation: undefined
        }));
      }

      return questions;
    } catch (error) {
      logger.error("Failed to get test questions", {
        skillTestId,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  },

  // Helper methods
  private transformSkillTest(row: any): SkillTest {
    return {
      id: row.id,
      certificationTypeId: row.certification_type_id,
      title: row.title,
      description: row.description,
      difficultyLevel: row.difficulty_level,
      durationMinutes: row.duration_minutes,
      passingScore: parseFloat(row.passing_score),
      questions: row.questions,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  private transformTestAttempt(row: any): TestAttempt {
    return {
      id: row.id,
      mentorId: row.mentor_id,
      skillTestId: row.skill_test_id,
      certificationId: row.certification_id,
      status: row.status,
      score: row.score ? parseFloat(row.score) : undefined,
      passed: row.passed,
      answers: row.answers,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      timeSpentMinutes: row.time_spent_minutes
    };
  },

  private calculateScore(
    questions: TestQuestion[],
    answers: Record<string, any>
  ): { score: number; totalPoints: number } {
    let score = 0;
    let totalPoints = 0;

    for (const question of questions) {
      totalPoints += question.points;

      const userAnswer = answers[question.id];
      if (!userAnswer) continue;

      // Check answer based on question type
      switch (question.type) {
        case 'multiple_choice':
        case 'true_false':
          if (userAnswer === question.correctAnswer) {
            score += question.points;
          }
          break;

        case 'short_answer':
          // Simple string comparison (case-insensitive)
          if (
            typeof userAnswer === 'string' &&
            typeof question.correctAnswer === 'string' &&
            userAnswer.toLowerCase().trim() === question.correctAnswer.toLowerCase().trim()
          ) {
            score += question.points;
          }
          break;

        case 'code':
          // Code questions would need more sophisticated checking
          // For now, mark as requiring manual review
          break;

        case 'essay':
          // Essay questions require manual grading
          break;
      }
    }

    return { score, totalPoints };
  }
};
