import { MentorsService } from '../../services/mentors.service';
import pool from '../../config/database';
import { CacheService } from '../../services/cache.service';
import { mockDeep, mockReset } from 'jest-mock-extended';

// Mock external dependencies
jest.mock('../../config/database');
jest.mock('../../services/cache.service');

const mockPool = pool as jest.Mocked<typeof pool>;
const mockCacheService = CacheService as jest.Mocked<typeof CacheService>;

describe('MentorsService', () => {
  beforeEach(() => {
    mockReset(mockPool);
    mockReset(mockCacheService);
  });

  describe('createProfile', () => {
    it('should create mentor profile successfully', async () => {
      const userId = 'user-123';
      const payload = {
        bio: 'Experienced mentor',
        hourlyRate: 50,
        expertise: ['JavaScript', 'React'],
      };

      const mockMentor = {
        id: userId,
        role: 'mentor',
        bio: payload.bio,
        hourly_rate: payload.hourlyRate,
        expertise: payload.expertise,
      };

      mockPool.query.mockResolvedValue({ rows: [mockMentor] });

      const result = await MentorsService.createProfile(userId, payload);

      expect(result).toEqual(mockMentor);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET'),
        expect.any(Array)
      );
    });

    it('should return null if user not found', async () => {
      const userId = 'nonexistent';
      const payload = { bio: 'Test bio' };

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await MentorsService.createProfile(userId, payload);

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return mentor from cache if available', async () => {
      const mentorId = 'mentor-123';
      const mockMentor = { id: mentorId, role: 'mentor' };

      mockCacheService.wrap.mockResolvedValue(mockMentor);

      const result = await MentorsService.findById(mentorId);

      expect(result).toEqual(mockMentor);
      expect(mockCacheService.wrap).toHaveBeenCalled();
    });

    it('should return null if mentor not found', async () => {
      const mentorId = 'nonexistent';

      mockCacheService.wrap.mockResolvedValue(null);

      const result = await MentorsService.findById(mentorId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update mentor profile successfully', async () => {
      const mentorId = 'mentor-123';
      const payload = {
        firstName: 'Updated',
        bio: 'Updated bio',
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

    it('should return null if mentor not found', async () => {
      const mentorId = 'nonexistent';
      const payload = { bio: 'Test' };

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await MentorsService.update(mentorId, payload);

      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should return paginated mentor list', async () => {
      const query = {
        page: 1,
        limit: 10,
        search: 'John',
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
      };

      const mockMentors = [
        { id: 'mentor-1', first_name: 'John', role: 'mentor' },
        { id: 'mentor-2', first_name: 'Jane', role: 'mentor' },
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
  });

  describe('setAvailability', () => {
    it('should set mentor availability successfully', async () => {
      const mentorId = 'mentor-123';
      const payload = {
        schedule: { monday: ['09:00-17:00'] },
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

  describe('getAvailability', () => {
    it('should return mentor availability', async () => {
      const mentorId = 'mentor-123';
      const mockAvailability = {
        availability_schedule: { monday: ['09:00-17:00'] },
        is_available: true,
      };

      mockPool.query.mockResolvedValue({ rows: [mockAvailability] });

      const result = await MentorsService.getAvailability(mentorId);

      expect(result).toEqual({
        schedule: mockAvailability.availability_schedule,
        isAvailable: mockAvailability.is_available,
      });
    });

    it('should return null if mentor not found', async () => {
      const mentorId = 'nonexistent';

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await MentorsService.getAvailability(mentorId);

      expect(result).toBeNull();
    });
  });

  describe('updatePricing', () => {
    it('should update mentor pricing successfully', async () => {
      const mentorId = 'mentor-123';
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

  describe('getSessions', () => {
    it('should return mentor sessions with pagination', async () => {
      const mentorId = 'mentor-123';
      const query = {
        page: 1,
        limit: 10,
        status: 'scheduled',
      };

      const mockSessions = [
        { id: 'session-1', mentor_id: mentorId, status: 'scheduled' },
        { id: 'session-2', mentor_id: mentorId, status: 'scheduled' },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockSessions })
        .mockResolvedValueOnce({ rows: [{ count: '2' }] });

      const result = await MentorsService.getSessions(mentorId, query);

      expect(result.sessions).toEqual(mockSessions);
      expect(result.total).toBe(2);
    });
  });

  describe('getEarnings', () => {
    it('should return earnings summary', async () => {
      const mentorId = 'mentor-123';
      const query = {
        from: new Date('2023-01-01'),
        to: new Date('2023-12-31'),
        groupBy: 'month' as const,
      };

      const mockSummary = {
        total_earnings: '1200.00',
        total_sessions: '24',
      };

      const mockBreakdown = [
        { period: '2023-01-01', earnings: '100.00', sessions: '2' },
        { period: '2023-02-01', earnings: '200.00', sessions: '4' },
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

    it('should throw error for invalid groupBy', async () => {
      const mentorId = 'mentor-123';
      const query = {
        groupBy: 'invalid' as any,
      };

      await expect(MentorsService.getEarnings(mentorId, query)).rejects.toThrow('Invalid groupBy value');
    });
  });

  describe('submitVerification', () => {
    it('should submit verification request successfully', async () => {
      const mentorId = 'mentor-123';
      const payload = {
        documentType: 'passport',
        documentUrl: 'https://example.com/doc.pdf',
        linkedinUrl: 'https://linkedin.com/in/mentor',
        additionalNotes: 'Additional notes',
      };

      mockPool.query.mockResolvedValue({});

      const result = await MentorsService.submitVerification(mentorId, payload);

      expect(result).toEqual({
        submitted: true,
        message: 'Verification request submitted successfully',
      });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET metadata'),
        expect.any(Array)
      );
    });
  });
});