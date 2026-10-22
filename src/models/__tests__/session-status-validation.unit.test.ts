import { SessionModel, SESSION_STATUSES, SessionStatus } from '../session.model';
import { createError } from '../../middleware/errorHandler';
import { ErrorCode } from '../../errors/error-codes';

describe('SessionModel updateStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SESSION_STATUSES constant', () => {
    it('exports the expected status values', () => {
      expect(SESSION_STATUSES).toEqual([
        'scheduled',
        'active',
        'paused',
        'completed',
        'cancelled',
        'no_show',
      ]);
    });

    it('is readonly (as const)', () => {
      // TypeScript enforces this at compile time; runtime test ensures array structure
      expect(Array.isArray(SESSION_STATUSES)).toBe(true);
      expect(SESSION_STATUSES.length).toBe(6);
    });
  });

  describe('SessionStatus type export', () => {
    it('allows SessionStatus type to be imported', () => {
      // This is a compile-time test; if it compiles, the type is exported correctly
      const status: SessionStatus = 'scheduled';
      expect(status).toBe('scheduled');
    });
  });

  describe('valid status acceptance', () => {
    it.each(SESSION_STATUSES)('accepts valid status: %s', async (status) => {
      ;(pool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'session-1',
          status,
          updated_at: new Date(),
        }],
      });

      const result = await SessionModel.updateStatus('session-1', status);

      expect(result?.status).toBe(status);
      expect(pool.query).toHaveBeenCalled();
    });
  });

  describe('invalid status rejection', () => {
    it('throws VALIDATION_ERROR for arbitrary invalid string', async () => {
      const invalidStatus = 'hacked';

      await expect(
        SessionModel.updateStatus('session-1', invalidStatus)
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        details: {
          message: 'Invalid session status: hacked. Allowed: scheduled, active, paused, completed, cancelled, no_show',
          field: 'status',
          value: 'hacked',
        },
      });

      // Ensure DB is NOT called
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR for empty string', async () => {
      await expect(
        SessionModel.updateStatus('session-1', '')
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        details: {
          field: 'status',
          value: '',
        },
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR for status with wrong casing', async () => {
      const invalidStatus = 'SCHEDULED'; // uppercase

      await expect(
        SessionModel.updateStatus('session-1', invalidStatus)
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        details: {
          field: 'status',
          value: 'SCHEDULED',
        },
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_ERROR for similar but invalid status', async () => {
      const invalidStatus = 'pending'; // not in SESSION_STATUSES

      await expect(
        SessionModel.updateStatus('session-1', invalidStatus)
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        statusCode: 400,
        details: {
          field: 'status',
          value: 'pending',
        },
      });
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws with correct ErrorCode, statusCode, and details', async () => {
      try {
        await SessionModel.updateStatus('session-1', 'invalid');
        fail('Expected to throw');
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(err.statusCode).toBe(400);
        expect(err.details).toEqual({
          message: 'Invalid session status: invalid. Allowed: scheduled, active, paused, completed, cancelled, no_show',
          field: 'status',
          value: 'invalid',
        });
      }
    });
  });

  describe('DB not called on invalid status', () => {
    it('does not execute UPDATE query when status is invalid', async () => {
      await expect(
        SessionModel.updateStatus('session-1', 'not-a-status')
      ).rejects.toThrow();

      // Verify pool.query was never called
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});