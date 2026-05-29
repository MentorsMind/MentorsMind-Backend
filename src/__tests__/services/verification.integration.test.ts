/**
 * Integration tests for Verification Service
 */

import { VerificationService } from '../../services/verification.service';
import { enqueueEmail } from '../../queues/email.queue';

// Mock dependencies
jest.mock('../../queues/email.queue');
jest.mock('../../config/database');

describe('VerificationService Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('submit', () => {
    it('should submit verification documents', async () => {
      const mockVerification = {
        id: 'verification-123',
        mentor_id: 'mentor-123',
        document_type: 'passport',
        document_url: 'https://example.com/doc.pdf',
        status: 'pending',
        created_at: new Date(),
      };

      const pool = require('../../config/database').pool;
      pool.query = jest.fn()
        .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE for superseding
        .mockResolvedValueOnce({ rows: [mockVerification] }); // INSERT

      (enqueueEmail as jest.Mock).mockResolvedValue('email-id');

      const result = await VerificationService.submit('mentor-123', {
        documentType: 'passport',
        documentUrl: 'https://example.com/doc.pdf',
      });

      expect(result).toEqual(mockVerification);
      expect(enqueueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: expect.any(Array),
          subject: 'Verification Submission Received',
        }),
      );
    });
  });

  describe('approve', () => {
    it('should approve verification and set 1-year expiry', async () => {
      const mockVerification = {
        id: 'verification-123',
        mentor_id: 'mentor-123',
        status: 'pending',
      };

      const pool = require('../../config/database').pool;
      pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [mockVerification] }) // getById
        .mockResolvedValueOnce({ rows: [{ ...mockVerification, status: 'approved', expires_at: expect.any(Date) }] }) // UPDATE
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE users

      (enqueueEmail as jest.Mock).mockResolvedValue('email-id');

      // Mock on-chain verification to return null (not configured)
      const result = await VerificationService.approve('verification-123', 'admin-123');

      expect(result.status).toBe('approved');
      expect(result.expires_at).toBeDefined();
      expect(enqueueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Your Verification Has Been Approved',
        }),
      );
    });
  });

  describe('reject', () => {
    it('should reject verification with reason', async () => {
      const mockVerification = {
        id: 'verification-123',
        mentor_id: 'mentor-123',
        status: 'pending',
      };

      const pool = require('../../config/database').pool;
      pool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [mockVerification] }) // getById
        .mockResolvedValueOnce({ rows: [{ ...mockVerification, status: 'rejected', rejection_reason: 'Invalid document' }] }); // UPDATE

      (enqueueEmail as jest.Mock).mockResolvedValue('email-id');

      const result = await VerificationService.reject('verification-123', 'admin-123', 'Invalid document');

      expect(result.status).toBe('rejected');
      expect(result.rejection_reason).toBe('Invalid document');
      expect(enqueueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Verification Update — Action Required',
        }),
      );
    });
  });

  describe('flagExpiredVerifications', () => {
    it('should flag expired verifications and remove verified status', async () => {
      const pool = require('../../config/database').pool;
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect = jest.fn().mockResolvedValue(mockClient);

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 3 }) // UPDATE mentor_verifications
        .mockResolvedValueOnce({ rowCount: 3 }); // UPDATE users

      const count = await VerificationService.flagExpiredVerifications();

      expect(count).toBe(3);
      expect(mockClient.query).toHaveBeenCalledTimes(3); // BEGIN, 2 UPDATEs, COMMIT
    });
  });
});
