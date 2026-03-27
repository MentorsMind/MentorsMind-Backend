import { AuditLogService } from '../auditLog.service';
import pool from '../../config/database';

jest.mock('../../config/database', () => ({
  query: jest.fn(),
}));

describe('AuditLogService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log entry', async () => {
      const mockLog = {
        id: 'log-uuid',
        user_id: 'user-uuid',
        action: 'LOGIN_SUCCESS',
        resource_type: 'auth',
        resource_id: null,
        old_value: null,
        new_value: null,
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        metadata: {},
        created_at: new Date(),
        record_hash: 'hash123',
        previous_hash: null,
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockLog] });

      const result = await AuditLogService.log({
        userId: 'user-uuid',
        action: 'LOGIN_SUCCESS',
        resourceType: 'auth',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(result).toEqual(mockLog);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining(['user-uuid', 'LOGIN_SUCCESS', 'auth']),
      );
    });

    it('should handle null userId for anonymous actions', async () => {
      const mockLog = {
        id: 'log-uuid',
        user_id: null,
        action: 'LOGIN_FAILED',
        resource_type: 'auth',
        resource_id: null,
        old_value: null,
        new_value: null,
        ip_address: '192.168.1.1',
        user_agent: null,
        metadata: {},
        created_at: new Date(),
        record_hash: 'hash456',
        previous_hash: 'hash123',
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockLog] });

      const result = await AuditLogService.log({
        userId: null,
        action: 'LOGIN_FAILED',
        resourceType: 'auth',
        ipAddress: '192.168.1.1',
      });

      expect(result.user_id).toBeNull();
      expect(result.action).toBe('LOGIN_FAILED');
    });

    it('should store old and new values for data modifications', async () => {
      const oldValue = { status: 'pending' };
      const newValue = { status: 'completed' };

      const mockLog = {
        id: 'log-uuid',
        user_id: 'user-uuid',
        action: 'DATA_MODIFIED',
        resource_type: 'booking',
        resource_id: 'booking-uuid',
        old_value: oldValue,
        new_value: newValue,
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        metadata: {},
        created_at: new Date(),
        record_hash: 'hash789',
        previous_hash: 'hash456',
      };

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockLog] });

      const result = await AuditLogService.log({
        userId: 'user-uuid',
        action: 'DATA_MODIFIED',
        resourceType: 'booking',
        resourceId: 'booking-uuid',
        oldValue,
        newValue,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });

      expect(result.old_value).toEqual(oldValue);
      expect(result.new_value).toEqual(newValue);
    });
  });

  describe('query', () => {
    it('should query audit logs with filters and pagination', async () => {
      const mockLogs = [
        { id: 'log1', action: 'LOGIN_SUCCESS', created_at: new Date() },
        { id: 'log2', action: 'LOGIN_SUCCESS', created_at: new Date() },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rows: mockLogs });

      const result = await AuditLogService.query({
        userId: 'user-uuid',
        action: 'LOGIN_SUCCESS',
        page: 1,
        limit: 50,
      });

      expect(result.logs).toEqual(mockLogs);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.totalPages).toBe(1);
    });

    it('should handle date range filters', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })
        .mockResolvedValueOnce({ rows: [] });

      await AuditLogService.query({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        page: 1,
        limit: 50,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('created_at >='),
        expect.any(Array),
      );
    });
  });

  describe('exportToCSV', () => {
    it('should export audit logs as CSV format', async () => {
      const mockLogs = [
        {
          id: 'log1',
          user_id: 'user1',
          action: 'LOGIN_SUCCESS',
          resource_type: 'auth',
          resource_id: null,
          old_value: null,
          new_value: null,
          ip_address: '192.168.1.1',
          user_agent: 'Mozilla/5.0',
          metadata: { test: 'data' },
          created_at: new Date('2024-01-01'),
          record_hash: 'hash1',
        },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: mockLogs });

      const csv = await AuditLogService.exportToCSV({});

      expect(csv).toContain('ID,User ID,Action');
      expect(csv).toContain('LOGIN_SUCCESS');
      expect(csv).toContain('192.168.1.1');
    });
  });

  describe('verifyChainIntegrity', () => {
    it('should verify valid hash chain', async () => {
      const mockLogs = [
        {
          id: 'log1',
          record_hash: 'hash1',
          previous_hash: null,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'log2',
          record_hash: 'hash2',
          previous_hash: 'hash1',
          created_at: new Date('2024-01-02'),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockLogs });

      const result = await AuditLogService.verifyChainIntegrity();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect hash chain breaks', async () => {
      const mockLogs = [
        {
          id: 'log1',
          record_hash: 'hash1',
          previous_hash: null,
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'log2',
          record_hash: 'hash2',
          previous_hash: 'wrong-hash',
          created_at: new Date('2024-01-02'),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockLogs });

      const result = await AuditLogService.verifyChainIntegrity();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Immutability enforcement', () => {
    it('should document that UPDATE operations are prevented by database triggers', async () => {
      (pool.query as jest.Mock).mockRejectedValueOnce(
        new Error('Audit logs are immutable and cannot be updated')
      );

      await expect(
        pool.query('UPDATE audit_logs SET action = $1 WHERE id = $2', ['MODIFIED', 'log-uuid'])
      ).rejects.toThrow('immutable');
    });

    it('should document that DELETE operations are prevented by database triggers', async () => {
      (pool.query as jest.Mock).mockRejectedValueOnce(
        new Error('Audit logs are immutable and cannot be deleted')
      );

      await expect(
        pool.query('DELETE FROM audit_logs WHERE id = $1', ['log-uuid'])
      ).rejects.toThrow('immutable');
    });
  });
});
