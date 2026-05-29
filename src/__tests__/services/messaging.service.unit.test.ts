jest.mock("../../config/database", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));
jest.mock("../../services/socket.service", () => ({
  SocketService: {
    emitToUser: jest.fn(),
  },
}));

import { MessagingService } from "../../services/messaging.service";
import pool from "../../config/database";

const mockPool = pool as unknown as { query: jest.Mock; connect: jest.Mock };

describe("MessagingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getOrCreateConversation", () => {
    const userAId = "user-123";
    const userBId = "user-456";

    it("should return null when only a cancelled booking exists", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [], // No valid bookings found
      });

      const result = await MessagingService.getOrCreateConversation(userAId, userBId);

      expect(result).toBeNull();
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('confirmed', 'in_progress', 'completed')"),
        [userAId, userBId]
      );
    });

    it("should return null when only a rejected booking exists", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [], // No valid bookings found
      });

      const result = await MessagingService.getOrCreateConversation(userAId, userBId);

      expect(result).toBeNull();
    });

    it("should return null when no booking exists", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      const result = await MessagingService.getOrCreateConversation(userAId, userBId);

      expect(result).toBeNull();
    });

    it("should create conversation when a confirmed booking exists", async () => {
      const mockConversation = {
        id: "conv-123",
        participant_one_id: userAId,
        participant_two_id: userBId,
        last_message_id: null,
        last_message_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: "booking-123" }], // Valid booking found
        })
        .mockResolvedValueOnce({
          rows: [mockConversation], // Conversation created
        });

      const result = await MessagingService.getOrCreateConversation(userAId, userBId);

      expect(result).toEqual(mockConversation);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it("should create conversation when an in_progress booking exists", async () => {
      const mockConversation = {
        id: "conv-123",
        participant_one_id: userAId,
        participant_two_id: userBId,
        last_message_id: null,
        last_message_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: "booking-123" }],
        })
        .mockResolvedValueOnce({
          rows: [mockConversation],
        });

      const result = await MessagingService.getOrCreateConversation(userAId, userBId);

      expect(result).toEqual(mockConversation);
    });

    it("should create conversation when a completed booking exists", async () => {
      const mockConversation = {
        id: "conv-123",
        participant_one_id: userAId,
        participant_two_id: userBId,
        last_message_id: null,
        last_message_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: "booking-123" }],
        })
        .mockResolvedValueOnce({
          rows: [mockConversation],
        });

      const result = await MessagingService.getOrCreateConversation(userAId, userBId);

      expect(result).toEqual(mockConversation);
    });
  });

  describe("searchMessages", () => {
    const userId = "user-123";
    const mockConversation = {
      id: "conv-123",
      participant_one_id: userId,
      participant_two_id: "user-456",
    };

    it("should handle normal search query successfully", async () => {
      const query = "hello world";
      
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: "msg-1",
            conversation_id: "conv-123",
            sender_id: "user-456",
            body: "Hello there world",
            is_deleted: false,
            deleted_at: null,
            read_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            headline: "<mark>Hello</mark> there <mark>world</mark>",
            sender_name: "John Doe",
            sender_avatar: null,
            total_count: "1",
          },
        ],
      });

      const result = await MessagingService.searchMessages(userId, query);

      expect(result).toEqual({
        results: expect.arrayContaining([
          expect.objectContaining({
            id: "msg-1",
            headline: "<mark>Hello</mark> there <mark>world</mark>",
          }),
        ]),
        total: 1,
        page: 1,
        totalPages: 1,
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("plainto_tsquery('english', $2)"),
        [userId, query, 20, 0]
      );
    });

    it("should safely handle special characters that cause tsquery syntax errors", async () => {
      const queriesWithSpecialChars = [
        "hello & world",
        "test | query",
        "search ! not",
        "quotes ' single",
        'double " quotes',
        "parentheses (test)",
        "brackets [test]",
        "braces {test}",
        "semicolons; test",
        "colon: test",
        "asterisk* test",
        "question? mark",
        "slash/ test",
        "backslash\\ test",
        "at@ symbol",
        "hash# tag",
        "dollar$ sign",
        "percent% sign",
        "caret^ symbol",
        "tilde~ symbol",
        "plus+ sign",
        "equal= sign",
        "less< than",
        "greater> than",
        "ampersand& and",
        "pipe| or",
        "exclamation! not",
      ];

      for (const query of queriesWithSpecialChars) {
        mockPool.query.mockResolvedValue({ rows: [] });
        
        const result = await MessagingService.searchMessages(userId, query);
        
        expect(result).toEqual({
          results: [],
          total: 0,
          page: 1,
          totalPages: 0,
        });

        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining("plainto_tsquery('english', $2)"),
          [userId, query, 20, 0]
        );
      }
    });

    it("should safely handle emoji and unicode characters", async () => {
      const unicodeQueries = [
        "😀 emoji test",
        "🎉 celebration",
        "❤️ heart",
        "ñ español",
        "français café",
        "日本語",
        "العربية",
        "русский",
        "中文",
        "🏳️‍🌈 rainbow",
        "test with ñ and café",
        "mix of 😀 and text",
      ];

      for (const query of unicodeQueries) {
        mockPool.query.mockResolvedValue({ rows: [] });
        
        const result = await MessagingService.searchMessages(userId, query);
        
        expect(result).toEqual({
          results: [],
          total: 0,
          page: 1,
          totalPages: 0,
        });

        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining("plainto_tsquery('english', $2)"),
          [userId, query, 20, 0]
        );
      }
    });

    it("should handle empty string query", async () => {
      const result = await MessagingService.searchMessages(userId, "");

      expect(result).toEqual({
        results: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("should handle null/undefined query", async () => {
      const result1 = await MessagingService.searchMessages(userId, null as any);
      const result2 = await MessagingService.searchMessages(userId, undefined as any);

      expect(result1).toEqual({
        results: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });
      expect(result2).toEqual({
        results: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("should handle whitespace-only query", async () => {
      const whitespaceQueries = ["   ", "\t", "\n", "  \t\n  "];

      for (const query of whitespaceQueries) {
        const result = await MessagingService.searchMessages(userId, query);

        expect(result).toEqual({
          results: [],
          total: 0,
          page: 1,
          totalPages: 0,
        });
      }

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("should reject queries longer than 200 characters", async () => {
      const longQuery = "a".repeat(201);
      
      const result = await MessagingService.searchMessages(userId, longQuery);

      expect(result).toEqual({
        results: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("should accept queries exactly 200 characters", async () => {
      const exactQuery = "a".repeat(200);
      
      mockPool.query.mockResolvedValue({ rows: [] });
      
      const result = await MessagingService.searchMessages(userId, exactQuery);

      expect(result).toEqual({
        results: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("plainto_tsquery('english', $2)"),
        [userId, exactQuery, 20, 0]
      );
    });

    it("should handle pagination correctly", async () => {
      const query = "test";
      const page = 2;
      const limit = 10;
      
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: "msg-1",
            conversation_id: "conv-123",
            sender_id: "user-456",
            body: "test message",
            is_deleted: false,
            deleted_at: null,
            read_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            headline: "<mark>test</mark> message",
            sender_name: "John Doe",
            sender_avatar: null,
            total_count: "25",
          },
        ],
      });

      const result = await MessagingService.searchMessages(userId, query, page, limit);

      expect(result).toEqual({
        results: expect.arrayContaining([
          expect.objectContaining({
            headline: "<mark>test</mark> message",
          }),
        ]),
        total: 25,
        page: 2,
        totalPages: 3,
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT $3 OFFSET $4"),
        [userId, query, limit, (page - 1) * limit]
      );
    });

    it("should use plainto_tsquery consistently throughout the query", async () => {
      const query = "test search";
      
      mockPool.query.mockResolvedValue({ rows: [] });
      
      await MessagingService.searchMessages(userId, query);

      const queryCall = mockPool.query.mock.calls[0][0];
      
      // Check that plainto_tsquery is used in both WHERE and ORDER BY clauses
      expect(queryCall).toMatch(/plainto_tsquery\('english', \$2\)/g);
      expect(queryCall).toContain("WHERE");
      expect(queryCall).toContain("ORDER BY");
      
      // Ensure no to_tsquery calls with the user input
      expect(queryCall).not.toMatch(/to_tsquery\('english', \$2\)/);
      
      expect(mockPool.query).toHaveBeenCalledWith(
        queryCall,
        [userId, query, 20, 0]
      );
    });

    it("should handle malicious SQL injection attempts safely", async () => {
      const maliciousQueries = [
        "'; DROP TABLE messages; --",
        "'; UPDATE users SET password_hash='hacked'; --",
        "'; SELECT * FROM users; --",
        "1' OR '1'='1",
        "admin'--",
        "' UNION SELECT password_hash FROM users --",
      ];

      for (const query of maliciousQueries) {
        mockPool.query.mockResolvedValue({ rows: [] });
        
        const result = await MessagingService.searchMessages(userId, query);
        
        expect(result).toEqual({
          results: [],
          total: 0,
          page: 1,
          totalPages: 0,
        });

        // Verify the query uses parameterized statements
        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining("$2"),
          [userId, query, 20, 0]
        );
      }
    });
  });
});
