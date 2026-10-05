import { Pool } from "pg";
import { logger } from "../utils/logger.utils";

export interface AdaptiveTest {
  id: string;
  userId: string;
  currentDifficulty: number;
  questionsAnswered: number;
  correctAnswers: number;
  estimatedLevel: number;
  isComplete: boolean;
}

export interface QuestionSelection {
  questionId: string;
  difficulty: number;
  reason: string;
}

export class AdaptiveTestingService {
  constructor(private pool: Pool) {}

  private readonly MIN_QUESTIONS = 10;
  private readonly MAX_QUESTIONS = 30;
  private readonly CONFIDENCE_THRESHOLD = 0.85;

  async startAdaptiveTest(
    userId: string,
    skillArea: string,
  ): Promise<AdaptiveTest> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO adaptive_tests (user_id, skill_area, current_difficulty, estimated_level, created_at)
         VALUES ($1, $2, 5, 5, NOW())
         RETURNING id, current_difficulty, estimated_level`,
        [userId, skillArea],
      );

      const test = result.rows[0];

      logger.info(
        { userId, skillArea, testId: test.id },
        "Started adaptive test",
      );

      return {
        id: test.id,
        userId,
        currentDifficulty: test.current_difficulty,
        questionsAnswered: 0,
        correctAnswers: 0,
        estimatedLevel: test.estimated_level,
        isComplete: false,
      };
    } catch (error) {
      logger.error(
        { error, userId, skillArea },
        "Failed to start adaptive test",
      );
      throw error;
    } finally {
      client.release();
    }
  }

  async selectNextQuestion(testId: string): Promise<QuestionSelection> {
    const client = await this.pool.connect();
    try {
      const testResult = await client.query(
        `SELECT current_difficulty, questions_answered, correct_answers, estimated_level
         FROM adaptive_tests WHERE id = $1`,
        [testId],
      );

      if (testResult.rows.length === 0) {
        throw new Error("Test not found");
      }

      const test = testResult.rows[0];

      // Item Response Theory (IRT) - select question closest to estimated ability
      const targetDifficulty = test.estimated_level;

      const questionResult = await client.query(
        `SELECT id, difficulty FROM question_bank
         WHERE skill_area = (SELECT skill_area FROM adaptive_tests WHERE id = $1)
         AND id NOT IN (SELECT question_id FROM test_responses WHERE test_id = $1)
         ORDER BY ABS(difficulty - $2)
         LIMIT 1`,
        [testId, targetDifficulty],
      );

      if (questionResult.rows.length === 0) {
        throw new Error("No more questions available");
      }

      const question = questionResult.rows[0];

      logger.info(
        { testId, questionId: question.id, difficulty: question.difficulty },
        "Selected next question",
      );

      return {
        questionId: question.id,
        difficulty: question.difficulty,
        reason: "Optimal difficulty match for estimated ability",
      };
    } catch (error) {
      logger.error({ error, testId }, "Failed to select next question");
      throw error;
    } finally {
      client.release();
    }
  }

  async processResponse(
    testId: string,
    questionId: string,
    isCorrect: boolean,
    responseTime: number,
  ): Promise<AdaptiveTest> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO test_responses (test_id, question_id, is_correct, response_time, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [testId, questionId, isCorrect, responseTime],
      );

      const testResult = await client.query(
        `SELECT questions_answered, correct_answers, current_difficulty, estimated_level
         FROM adaptive_tests WHERE id = $1`,
        [testId],
      );

      const test = testResult.rows[0];
      const newQuestionsAnswered = test.questions_answered + 1;
      const newCorrectAnswers = test.correct_answers + (isCorrect ? 1 : 0);

      // Update estimated level using Bayesian inference
      const newEstimatedLevel = this.updateEstimatedLevel(
        test.estimated_level,
        test.current_difficulty,
        isCorrect,
        responseTime,
      );

      // Adjust next question difficulty
      const newDifficulty = this.adjustDifficulty(
        test.current_difficulty,
        isCorrect,
      );

      // Check if test should terminate
      const confidence = this.calculateConfidence(
        newQuestionsAnswered,
        newCorrectAnswers,
      );
      const isComplete =
        newQuestionsAnswered >= this.MIN_QUESTIONS &&
        (confidence >= this.CONFIDENCE_THRESHOLD ||
          newQuestionsAnswered >= this.MAX_QUESTIONS);

      await client.query(
        `UPDATE adaptive_tests
         SET questions_answered = $1,
             correct_answers = $2,
             current_difficulty = $3,
             estimated_level = $4,
             is_complete = $5,
             confidence_score = $6,
             updated_at = NOW()
         WHERE id = $7`,
        [
          newQuestionsAnswered,
          newCorrectAnswers,
          newDifficulty,
          newEstimatedLevel,
          isComplete,
          confidence,
          testId,
        ],
      );

      await client.query("COMMIT");

      logger.info(
        { testId, isCorrect, newEstimatedLevel, isComplete },
        "Processed test response",
      );

      return {
        id: testId,
        userId: "", // Would be fetched if needed
        currentDifficulty: newDifficulty,
        questionsAnswered: newQuestionsAnswered,
        correctAnswers: newCorrectAnswers,
        estimatedLevel: newEstimatedLevel,
        isComplete,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error({ error, testId, questionId }, "Failed to process response");
      throw error;
    } finally {
      client.release();
    }
  }

  async getTestResults(testId: string): Promise<{
    finalLevel: number;
    confidence: number;
    strengths: string[];
    weaknesses: string[];
    recommendedPath: string;
  }> {
    const client = await this.pool.connect();
    try {
      const testResult = await client.query(
        `SELECT estimated_level, confidence_score, questions_answered, correct_answers
         FROM adaptive_tests WHERE id = $1`,
        [testId],
      );

      if (testResult.rows.length === 0) {
        throw new Error("Test not found");
      }

      const test = testResult.rows[0];

      // Analyze response patterns for strengths/weaknesses
      const responsesResult = await client.query(
        `SELECT q.topic, tr.is_correct
         FROM test_responses tr
         JOIN question_bank q ON tr.question_id = q.id
         WHERE tr.test_id = $1`,
        [testId],
      );

      const topicPerformance = this.analyzeTopicPerformance(
        responsesResult.rows,
      );

      logger.info(
        { testId, finalLevel: test.estimated_level },
        "Retrieved test results",
      );

      return {
        finalLevel: test.estimated_level,
        confidence: test.confidence_score,
        strengths: topicPerformance.strengths,
        weaknesses: topicPerformance.weaknesses,
        recommendedPath: this.generateRecommendedPath(
          test.estimated_level,
          topicPerformance,
        ),
      };
    } catch (error) {
      logger.error({ error, testId }, "Failed to get test results");
      throw error;
    } finally {
      client.release();
    }
  }

  private updateEstimatedLevel(
    currentLevel: number,
    questionDifficulty: number,
    isCorrect: boolean,
    responseTime: number,
  ): number {
    // Simplified IRT model
    const learningRate = 0.2;
    const timeBonus = responseTime < 30000 ? 0.1 : 0; // Bonus for quick correct answers

    if (isCorrect) {
      return Math.min(
        10,
        currentLevel +
          learningRate * (questionDifficulty - currentLevel) +
          timeBonus,
      );
    } else {
      return Math.max(
        1,
        currentLevel - learningRate * (currentLevel - questionDifficulty),
      );
    }
  }

  private adjustDifficulty(
    currentDifficulty: number,
    isCorrect: boolean,
  ): number {
    const adjustment = isCorrect ? 1 : -1;
    return Math.max(1, Math.min(10, currentDifficulty + adjustment));
  }

  private calculateConfidence(
    questionsAnswered: number,
    correctAnswers: number,
  ): number {
    if (questionsAnswered === 0) return 0;

    // Simple confidence based on consistency
    const accuracy = correctAnswers / questionsAnswered;
    const sampleSize = Math.min(1, questionsAnswered / this.MIN_QUESTIONS);

    return accuracy * sampleSize;
  }

  private analyzeTopicPerformance(responses: any[]): {
    strengths: string[];
    weaknesses: string[];
  } {
    const topicScores: Record<string, { correct: number; total: number }> = {};

    for (const response of responses) {
      if (!topicScores[response.topic]) {
        topicScores[response.topic] = { correct: 0, total: 0 };
      }
      topicScores[response.topic].total++;
      if (response.is_correct) {
        topicScores[response.topic].correct++;
      }
    }

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const [topic, scores] of Object.entries(topicScores)) {
      const accuracy = scores.correct / scores.total;
      if (accuracy >= 0.8) {
        strengths.push(topic);
      } else if (accuracy < 0.5) {
        weaknesses.push(topic);
      }
    }

    return { strengths, weaknesses };
  }

  private generateRecommendedPath(
    level: number,
    performance: { strengths: string[]; weaknesses: string[] },
  ): string {
    if (level >= 8) {
      return "Advanced certification track";
    } else if (level >= 5) {
      return "Intermediate specialization";
    } else {
      return "Foundation building";
    }
  }
}

