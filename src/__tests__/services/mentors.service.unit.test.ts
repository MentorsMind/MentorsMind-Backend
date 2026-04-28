import { MentorsService } from "../../services/mentors.service";
import pool from "../../config/database";
import { CacheService } from "../../services/cache.service";
// Mock external dependencies
jest.mock("../../config/database");
jest.mock("../../services/cache.service");

const mockPool = pool as jest.Mocked<typeof pool>;
const mockCacheService = CacheService as jest.Mocked<typeof CacheService>;

describe("MentorsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createProfile", () => {
    it("should create mentor profile successfully", async () => {
      const userId = "user-123";
      const payload = {
        bio: "Experienced mentor",
        hourlyRate: 50,
        expertise: ["JavaScript", "React"],
      };

      const mockMentor = {
        id: userId,
        role: "mentor",
        bio: payload.bio,
        hourly_rate: payload.hourlyRate,
        expertise: payload.expertise,
      };

      mockPool.query.mockResolvedValue({ rows: [mockMentor] });

      const result = await MentorsService.createProfile(userId, payload);

      expect(result).toEqual(mockMentor);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE users SET"),
        expect.any(Array),
      );
    });

    it("should return null if user not found", async () => {
      const userId = "nonexistent";
      const payload = { bio: "Test bio" };

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await MentorsService.createProfile(userId, payload);

      expect(result).toBeNull();
    });
  });

  describe("findById", () => {
    it("should return mentor from cache if available", async () => {
      const mentorId = "mentor-123";
      const mockMentor = { id: mentorId, role: "mentor" };

      mockCacheService.wrap.mockResolvedValue(mockMentor);

      const result = await MentorsService.findById(mentorId);

      expect(result).toEqual(mockMentor);
      expect(mockCacheService.wrap).toHaveBeenCalled();
    });

    it("should return null if mentor not found", async () => {
      const mentorId = "nonexistent";

      mockCacheService.wrap.mockResolvedValue(null);

      const result = await MentorsService.findById(mentorId);

      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should update mentor profile successfully", async () => {
      const mentorId = "mentor-123";
      const payload = {
        firstName: "Updated",
        bio: "Updated bio",
        hourlyRate: 60,
      };

      const mockUpdatedMentor = {
        id: mentorId,
        first_name: payload.firstName,
        bio: payload.bio,
        hourly_rate: payload.hourlyRate,
      };

      mockPool.query.mockResolvedValue({ rows: [mockUpdatedMentor] });
      mockCacheService.del.mockResolvedValue(true);
      mockCacheService.invalidatePattern.mockResolvedValue([]);

      const result = await MentorsService.update(mentorId, payload);

      expect(result).toEqual(mockUpdatedMentor);
      expect(mockCacheService.del).toHaveBeenCalled();
      expect(mockCacheService.invalidatePattern).toHaveBeenCalledTimes(2);
    });

    it("should return null if mentor not found", async () => {
      const mentorId = "nonexistent";
      const payload = { bio: "Test" };

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await MentorsService.update(mentorId, payload);

      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("should return paginated mentor list", async () => {
      const query = {
        page: 1,
        limit: 10,
        search: "John",
        sortBy: "createdAt" as const,
        sortOrder: "desc" as const,
      };

      const mockMentors = [
        { id: "mentor-1", first_name: "John", role: "mentor" },
        { id: "mentor-2", first_name: "Jane", role: "mentor" },
      ];

      mockCacheService.wrap.mockResolvedValue({
        mentors: mockMentors,
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });

      const result = await MentorsService.list(query);

      expect(result.mentors).toEqual(mockMentors);
      expect(result.total).toBe(2);
      expect(mockCacheService.wrap).toHaveBeenCalled();
    });

    it("should apply all filters including minRate, maxRate, and isAvailable to count query", async () => {
      const query = {
        limit: 10,
        search: "JavaScript",
        expertise: "React",
        minRate: 30,
        maxRate: 100,
        isAvailable: true,
      };

      const mockMentors = [
        { 
          id: "mentor-1", 
          first_name: "John", 
          role: "mentor",
          hourly_rate: 50,
          is_available: true,
          expertise: ["React", "JavaScript"],
        },
        { 
          id: "mentor-2", 
          first_name: "Jane", 
          role: "mentor",
          hourly_rate: 75,
          is_available: true,
          expertise: ["React", "Node.js"],
        },
      ];

      // Mock the cache.wrap to execute the callback
      mockCacheService.wrap.mockImplementation(async (_key, _ttl, callback) => {
        return callback();
      });

      // Mock both queries: data query and count query
      mockPool.query
        .mockResolvedValueOnce({ rows: mockMentors }) // data query
        .mockResolvedValueOnce({ rows: [{ count: "2" }] }); // count query

      const result = await MentorsService.list(query);

      expect(result.mentors).toHaveLength(2);
      expect(result.total).toBe(2);
      
      // Verify that pool.query was called twice (data + count)
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      
      // Verify the count query includes all filters
      const countQueryCall = mockPool.query.mock.calls[1];
      const countQuery = countQueryCall[0] as string;
      const countValues = countQueryCall[1] as unknown[];
      
      // Count query should include all filter conditions
      expect(countQuery).toContain("role = 'mentor'");
      expect(countQuery).toContain("is_active = true");
      expect(countQuery).toContain("ILIKE"); // search filter
      expect(countQuery).toContain("ANY(expertise)"); // expertise filter
      expect(countQuery).toContain("hourly_rate >="); // minRate filter
      expect(countQuery).toContain("hourly_rate <="); // maxRate filter
      expect(countQuery).toContain("is_available ="); // isAvailable filter
      
      // Verify all filter values are passed to count query
      expect(countValues).toContain(`%${query.search}%`);
      expect(countValues).toContain(query.expertise);
      expect(countValues).toContain(query.minRate);
      expect(countValues).toContain(query.maxRate);
      expect(countValues).toContain(query.isAvailable);
    });

    it("should return correct total count when only minRate and maxRate filters are applied", async () => {
      const query = {
        limit: 10,
        minRate: 50,
        maxRate: 150,
      };

      const mockMentors = [
        { id: "mentor-1", hourly_rate: 75 },
        { id: "mentor-2", hourly_rate: 100 },
        { id: "mentor-3", hourly_rate: 125 },
      ];

      mockCacheService.wrap.mockImplementation(async (_key, _ttl, callback) => {
        return callback();
      });

      mockPool.query
        .mockResolvedValueOnce({ rows: mockMentors })
        .mockResolvedValueOnce({ rows: [{ count: "3" }] });

      const result = await MentorsService.list(query);

      expect(result.total).toBe(3);
      expect(result.mentors).toHaveLength(3);
      
      const countQueryCall = mockPool.query.mock.calls[1];
      const countQuery = countQueryCall[0] as string;
      const countValues = countQueryCall[1] as unknown[];
      
      expect(countQuery).toContain("hourly_rate >=");
      expect(countQuery).toContain("hourly_rate <=");
      expect(countValues).toContain(query.minRate);
      expect(countValues).toContain(query.maxRate);
    });

    it("should return correct total count when only isAvailable filter is applied", async () => {
      const query = {
        limit: 10,
        isAvailable: true,
      };

      const mockMentors = [
        { id: "mentor-1", is_available: true },
        { id: "mentor-2", is_available: true },
      ];

      mockCacheService.wrap.mockImplementation(async (_key, _ttl, callback) => {
        return callback();
      });

      mockPool.query
        .mockResolvedValueOnce({ rows: mockMentors })
        .mockResolvedValueOnce({ rows: [{ count: "2" }] });

      const result = await MentorsService.list(query);

      expect(result.total).toBe(2);
      expect(result.mentors).toHaveLength(2);
      
      const countQueryCall = mockPool.query.mock.calls[1];
      const countQuery = countQueryCall[0] as string;
      const countValues = countQueryCall[1] as unknown[];
      
      expect(countQuery).toContain("is_available =");
      expect(countValues).toContain(query.isAvailable);
    });

    it("should verify total count matches actual filtered results for all filter combinations", async () => {
      const query = {
        limit: 10,
        search: "mentor",
        expertise: "TypeScript",
        minRate: 40,
        maxRate: 80,
        isAvailable: false,
      };

      const mockMentors = [
        { 
          id: "mentor-1",
          first_name: "Mentor One",
          hourly_rate: 60,
          is_available: false,
          expertise: ["TypeScript"],
        },
      ];

      mockCacheService.wrap.mockImplementation(async (_key, _ttl, callback) => {
        return callback();
      });

      mockPool.query
        .mockResolvedValueOnce({ rows: mockMentors })
        .mockResolvedValueOnce({ rows: [{ count: "1" }] });

      const result = await MentorsService.list(query);

      // The total should match the actual number of mentors returned
      expect(result.total).toBe(1);
      expect(result.mentors).toHaveLength(1);
      
      // Verify both queries use the same base filters
      const dataQueryCall = mockPool.query.mock.calls[0];
      const countQueryCall = mockPool.query.mock.calls[1];
      
      const dataValues = dataQueryCall[1] as unknown[];
      const countValues = countQueryCall[1] as unknown[];
      
      // Both queries should have the same filter values (excluding cursor and limit)
      expect(countValues).toContain(`%${query.search}%`);
      expect(countValues).toContain(query.expertise);
      expect(countValues).toContain(query.minRate);
      expect(countValues).toContain(query.maxRate);
      expect(countValues).toContain(query.isAvailable);
    });
  });

  describe("buildMentorFilters", () => {
    it("should build filters with all parameters", () => {
      const query = {
        search: "test",
        expertise: "React",
        minRate: 30,
        maxRate: 100,
        isAvailable: true,
      };

      const result = MentorsService.buildMentorFilters(query, 1);

      expect(result.conditions).toHaveLength(7); // 2 base + 5 filters
      expect(result.conditions).toContain("role = 'mentor'");
      expect(result.conditions).toContain("is_active = true");
      expect(result.conditions.some(c => c.includes("ILIKE"))).toBe(true);
      expect(result.conditions.some(c => c.includes("ANY(expertise)"))).toBe(true);
      expect(result.conditions.some(c => c.includes("hourly_rate >="))).toBe(true);
      expect(result.conditions.some(c => c.includes("hourly_rate <="))).toBe(true);
      expect(result.conditions.some(c => c.includes("is_available ="))).toBe(true);
      
      expect(result.values).toHaveLength(5);
      expect(result.values).toContain("%test%");
      expect(result.values).toContain("React");
      expect(result.values).toContain(30);
      expect(result.values).toContain(100);
      expect(result.values).toContain(true);
      
      expect(result.nextIdx).toBe(6); // started at 1, added 5 values
    });

    it("should build filters with only search parameter", () => {
      const query = {
        search: "mentor",
      };

      const result = MentorsService.buildMentorFilters(query, 1);

      expect(result.conditions).toHaveLength(3); // 2 base + 1 filter
      expect(result.values).toHaveLength(1);
      expect(result.values[0]).toBe("%mentor%");
      expect(result.nextIdx).toBe(2);
    });

    it("should build filters with only rate range", () => {
      const query = {
        minRate: 50,
        maxRate: 150,
      };

      const result = MentorsService.buildMentorFilters(query, 1);

      expect(result.conditions).toHaveLength(4); // 2 base + 2 filters
      expect(result.values).toHaveLength(2);
      expect(result.values).toContain(50);
      expect(result.values).toContain(150);
      expect(result.nextIdx).toBe(3);
    });

    it("should build filters with custom start index", () => {
      const query = {
        search: "test",
        isAvailable: true,
      };

      const result = MentorsService.buildMentorFilters(query, 5);

      expect(result.conditions.some(c => c.includes("$5"))).toBe(true);
      expect(result.conditions.some(c => c.includes("$6"))).toBe(true);
      expect(result.nextIdx).toBe(7);
    });

    it("should build base filters when no optional parameters provided", () => {
      const query = {};

      const result = MentorsService.buildMentorFilters(query, 1);

      expect(result.conditions).toHaveLength(2); // only base conditions
      expect(result.conditions).toContain("role = 'mentor'");
      expect(result.conditions).toContain("is_active = true");
      expect(result.values).toHaveLength(0);
      expect(result.nextIdx).toBe(1);
    });
  });

  describe("setAvailability", () => {
    it("should set mentor availability successfully", async () => {
      const mentorId = "mentor-123";
      const payload = {
        schedule: { monday: ["09:00-17:00"] },
        isAvailable: true,
      };

      const mockUpdatedMentor = {
        id: mentorId,
        availability_schedule: payload.schedule,
        is_available: payload.isAvailable,
      };

      mockPool.query.mockResolvedValue({ rows: [mockUpdatedMentor] });
      mockCacheService.del.mockResolvedValue(true);

      const result = await MentorsService.setAvailability(mentorId, payload);

      expect(result).toEqual(mockUpdatedMentor);
      expect(mockCacheService.del).toHaveBeenCalled();
    });
  });

  describe("getAvailability", () => {
    it("should return mentor availability", async () => {
      const mentorId = "mentor-123";
      const mockAvailability = {
        availability_schedule: { monday: ["09:00-17:00"] },
        is_available: true,
      };

      mockPool.query.mockResolvedValue({ rows: [mockAvailability] });

      const result = await MentorsService.getAvailability(mentorId);

      expect(result).toEqual({
        schedule: mockAvailability.availability_schedule,
        isAvailable: mockAvailability.is_available,
      });
    });

    it("should return null if mentor not found", async () => {
      const mentorId = "nonexistent";

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await MentorsService.getAvailability(mentorId);

      expect(result).toBeNull();
    });
  });

  describe("updatePricing", () => {
    it("should update mentor pricing successfully", async () => {
      const mentorId = "mentor-123";
      const payload = { hourlyRate: 75 };

      const mockUpdatedMentor = {
        id: mentorId,
        hourly_rate: payload.hourlyRate,
      };

      mockPool.query.mockResolvedValue({ rows: [mockUpdatedMentor] });
      mockCacheService.del.mockResolvedValue(true);
      mockCacheService.invalidatePattern.mockResolvedValue([]);

      const result = await MentorsService.updatePricing(mentorId, payload);

      expect(result).toEqual(mockUpdatedMentor);
      expect(mockCacheService.del).toHaveBeenCalled();
      expect(mockCacheService.invalidatePattern).toHaveBeenCalled();
    });
  });

  describe("getSessions", () => {
    it("should return mentor sessions with pagination", async () => {
      const mentorId = "mentor-123";
      const query = {
        page: 1,
        limit: 10,
        status: "scheduled",
      };

      const mockSessions = [
        { id: "session-1", mentor_id: mentorId, status: "scheduled" },
        { id: "session-2", mentor_id: mentorId, status: "scheduled" },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockSessions })
        .mockResolvedValueOnce({ rows: [{ count: "2" }] });

      const result = await MentorsService.getSessions(mentorId, query);

      expect(result.sessions).toEqual(mockSessions);
      expect(result.total).toBe(2);
    });
  });

  describe("getEarnings", () => {
    it("should return earnings summary", async () => {
      const mentorId = "mentor-123";
      const query = {
        from: new Date("2023-01-01"),
        to: new Date("2023-12-31"),
        groupBy: "month" as const,
      };

      const mockSummary = {
        total_earnings: "1200.00",
        total_sessions: "24",
      };

      const mockBreakdown = [
        { period: "2023-01-01", earnings: "100.00", sessions: "2" },
        { period: "2023-02-01", earnings: "200.00", sessions: "4" },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: [mockSummary] })
        .mockResolvedValueOnce({ rows: mockBreakdown });

      const result = await MentorsService.getEarnings(mentorId, query);

      expect(result.totalEarnings).toBe(1200);
      expect(result.totalSessions).toBe(24);
      expect(result.averagePerSession).toBe(50);
      expect(result.breakdown).toHaveLength(2);
    });

    it("should throw error for invalid groupBy", async () => {
      const mentorId = "mentor-123";
      const query = {
        groupBy: "invalid" as any,
      };

      await expect(MentorsService.getEarnings(mentorId, query)).rejects.toThrow(
        "Invalid groupBy value",
      );
    });
  });

  describe("submitVerification", () => {
    it("should submit verification request successfully", async () => {
      const mentorId = "mentor-123";
      const payload = {
        documentType: "passport",
        documentUrl: "https://example.com/doc.pdf",
        linkedinUrl: "https://linkedin.com/in/mentor",
        additionalNotes: "Additional notes",
      };

      mockPool.query.mockResolvedValue({});

      const result = await MentorsService.submitVerification(mentorId, payload);

      expect(result).toEqual({
        submitted: true,
        message: "Verification request submitted successfully",
      });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("jsonb_set"),
        expect.any(Array),
      );
    });
  });
});
