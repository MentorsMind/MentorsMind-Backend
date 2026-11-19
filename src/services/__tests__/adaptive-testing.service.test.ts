import { Pool, PoolClient } from "pg";
import { AdaptiveTestingService } from "../adaptive-testing.service";

describe("AdaptiveTestingService", () => {
  let mockClient: {
    query: jest.Mock;
    release: jest.Mock;
  };
  let mockPool: {
    connect: jest.Mock;
  };
  let service: AdaptiveTestingService;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient as unknown as PoolClient),
    };
    service = new AdaptiveTestingService(mockPool as unknown as Pool);
  });

  describe("startAdaptiveTest", () => {
    it("creates a new adaptive test with default difficulty 5 and estimated level 5", async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: "test-uuid-1", current_difficulty: 5, estimated_level: 5 }],
      });

      const result = await service.startAdaptiveTest("user-123", "TypeScript/JavaScript");

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO adaptive_tests"),
        ["user-123", "TypeScript/JavaScript"]
      );
      expect(mockClient.release).toHaveBeenCalled();
      expect(result).toEqual({
        id: "test-uuid-1",
        userId: "user-123",
        currentDifficulty: 5,
        questionsAnswered: 0,
        correctAnswers: 0,
        estimatedLevel: 5,
        isComplete: false,
      });
    });

    it("releases client and throws if query fails", async () => {
      mockClient.query.mockRejectedValueOnce(new Error("Database connection lost"));

      await expect(service.startAdaptiveTest("user-123", "Python")).rejects.toThrow(
        "Database connection lost"
      );
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe("selectNextQuestion", () => {
    it("selects question closest to estimated ability level using IRT", async () => {
      mockClient.query
        // 1. Fetch test state
        .mockResolvedValueOnce({
          rows: [
            {
              current_difficulty: 5,
              questions_answered: 2,
              correct_answers: 2,
              estimated_level: 6,
            },
          ],
        })
        // 2. Fetch optimal question from question_bank
        .mockResolvedValueOnce({
          rows: [{ id: "q-uuid-77", difficulty: 6 }],
        });

      const result = await service.selectNextQuestion("test-uuid-1");

      expect(result).toEqual({
        questionId: "q-uuid-77",
        difficulty: 6,
        reason: "Optimal difficulty match for estimated ability",
      });
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("throws if test is not found", async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.selectNextQuestion("invalid-test")).rejects.toThrow("Test not found");
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("throws if no more questions are available", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [{ current_difficulty: 5, questions_answered: 5, correct_answers: 3, estimated_level: 5 }],
        })
        .mockResolvedValueOnce({ rows: [] });

      await expect(service.selectNextQuestion("test-uuid-1")).rejects.toThrow(
        "No more questions available"
      );
    });
  });

  describe("processResponse", () => {
    it("records response, updates difficulty and returns updated test state", async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // INSERT into test_responses
        .mockResolvedValueOnce({
          // SELECT adaptive_tests
          rows: [
            {
              questions_answered: 2,
              correct_answers: 1,
              current_difficulty: 5,
              estimated_level: 5.2,
            },
          ],
        })
        .mockResolvedValueOnce({}) // UPDATE adaptive_tests
        .mockResolvedValueOnce({}); // COMMIT

      const result = await service.processResponse("test-uuid-1", "q-uuid-1", true, 15000);

      expect(result.questionsAnswered).toBe(3);
      expect(result.correctAnswers).toBe(2);
      expect(result.currentDifficulty).toBe(6); // increased on correct answer
      expect(result.isComplete).toBe(false); // below MIN_QUESTIONS (10)
      expect(mockClient.release).toHaveBeenCalled();
    });

    it("rolls back transaction on error", async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error("Insert error")); // INSERT fails

      await expect(
        service.processResponse("test-uuid-1", "q-uuid-1", false, 20000)
      ).rejects.toThrow("Insert error");

      expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe("getTestResults", () => {
    it("calculates level, confidence score, strengths, and weaknesses from topic performance", async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              estimated_level: 8.5,
              confidence_score: 0.9,
              questions_answered: 15,
              correct_answers: 13,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { topic: "Types", is_correct: true },
            { topic: "Types", is_correct: true },
            { topic: "Types", is_correct: true },
            { topic: "Prototypes", is_correct: false },
            { topic: "Prototypes", is_correct: false },
          ],
        });

      const results = await service.getTestResults("test-uuid-1");

      expect(results.finalLevel).toBe(8.5);
      expect(results.confidence).toBe(0.9);
      expect(results.strengths).toContain("Types");
      expect(results.weaknesses).toContain("Prototypes");
      expect(results.recommendedPath).toBe("Advanced certification track");
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
