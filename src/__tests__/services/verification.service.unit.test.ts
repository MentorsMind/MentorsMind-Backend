/**
 * Unit tests for Verification Service — Issue #103
 */

import { VerificationService } from '../../services/verification.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../../config/database', () => ({ query: (...args: any[]) => mockQuery(...args) }));

const mockEnqueueEmail = jest.fn().mockResolvedValue(undefined);
jest.mock('../../queues/email.queue', () => ({ enqueueEmail: (...args: any[]) => mockEnqueueEmail(...args) }));

jest.mock('../../utils/logger.utils', () => ({
    logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeVerification = (overrides = {}) => ({
    id: 'ver-uuid-1',
    mentor_id: 'mentor-uuid-1',
    document_type: 'passport',
    document_url: 'https://docs.example.com/passport.pdf',
    credential_url: null,
    linkedin_url: null,
    additional_notes: null,
    status: 'pending',
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
    additional_info_request: null,
    on_chain_tx_hash: null,
    expires_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    mentor_email: 'mentor@example.com',
    mentor_first_name: 'Alice',
    mentor_last_name: 'Smith',
    ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('VerificationService', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('submit', () => {
        it('creates a verification record and sends confirmation email', async () => {
            const verification = makeVerification();

            mockQuery
                .mockResolvedValueOnce({ rows: [] })              // cancel existing pending
                .mockResolvedValueOnce({ rows: [verification] })  // INSERT
                .mockResolvedValueOnce({ rows: [{ email: 'mentor@example.com', first_name: 'Alice' }] }); // email lookup

            const result = await VerificationService.submit('mentor-uuid-1', {
                documentType: 'passport',
                documentUrl: 'https://docs.example.com/passport.pdf',
            });

            expect(result.id).toBe('ver-uuid-1');
            expect(result.status).toBe('pending');
            expect(mockEnqueueEmail).toHaveBeenCalledTimes(1);
            expect(mockEnqueueEmail.mock.calls[0][0].to).toContain('mentor@example.com');
        });

        it('supersedes an existing pending submission', async () => {
            const verification = makeVerification();

            mockQuery
                .mockResolvedValueOnce({ rows: [] })              // UPDATE existing pending
                .mockResolvedValueOnce({ rows: [verification] })  // INSERT new
                .mockResolvedValueOnce({ rows: [{ email: 'mentor@example.com', first_name: 'Alice' }] });

            await VerificationService.submit('mentor-uuid-1', {
                documentType: 'national_id',
                documentUrl: 'https://docs.example.com/id.pdf',
            });

            // First query should be the UPDATE to cancel existing pending
            const firstCall = mockQuery.mock.calls[0][0] as string;
            expect(firstCall).toContain('UPDATE mentor_verifications');
            expect(firstCall).toContain("status = 'rejected'");
        });
    });

    describe('approve', () => {
        it('approves verification, sets is_verified=true, and sends email', async () => {
            const verification = makeVerification();
            const approved = makeVerification({ status: 'approved', expires_at: new Date() });

            mockQuery
                .mockResolvedValueOnce({ rows: [verification] })  // getById
                .mockResolvedValueOnce({ rows: [approved] })      // UPDATE verification
                .mockResolvedValueOnce({ rows: [] })              // UPDATE users is_verified
                .mockResolvedValueOnce({ rows: [{ email: 'mentor@example.com', first_name: 'Alice' }] }); // email lookup

            const result = await VerificationService.approve('ver-uuid-1', 'admin-uuid-1');

            expect(result.status).toBe('approved');

            // is_verified should be set on users table
            const userUpdateCall = mockQuery.mock.calls.find(
                (c) => typeof c[0] === 'string' && c[0].includes('is_verified = TRUE'),
            );
            expect(userUpdateCall).toBeDefined();

            expect(mockEnqueueEmail).toHaveBeenCalledTimes(1);
        });

        it('throws if verification is not in a reviewable state', async () => {
            const alreadyApproved = makeVerification({ status: 'approved' });
            mockQuery.mockResolvedValueOnce({ rows: [alreadyApproved] });

            await expect(
                VerificationService.approve('ver-uuid-1', 'admin-uuid-1'),
            ).rejects.toThrow('not in a reviewable state');
        });

        it('throws if verification not found', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await expect(
                VerificationService.approve('nonexistent', 'admin-uuid-1'),
            ).rejects.toThrow('Verification not found');
        });
    });

    describe('reject', () => {
        it('rejects verification and sends email with reason', async () => {
            const verification = makeVerification();
            const rejected = makeVerification({ status: 'rejected', rejection_reason: 'Blurry document' });

            mockQuery
                .mockResolvedValueOnce({ rows: [verification] })
                .mockResolvedValueOnce({ rows: [rejected] })
                .mockResolvedValueOnce({ rows: [{ email: 'mentor@example.com', first_name: 'Alice' }] });

            const result = await VerificationService.reject('ver-uuid-1', 'admin-uuid-1', 'Blurry document');

            expect(result.status).toBe('rejected');
            expect(mockEnqueueEmail).toHaveBeenCalledTimes(1);
            const emailBody = mockEnqueueEmail.mock.calls[0][0].textContent as string;
            expect(emailBody).toContain('Blurry document');
        });
    });

    describe('requestMoreInfo', () => {
        it('sets status to more_info_requested and sends email', async () => {
            const verification = makeVerification();
            const updated = makeVerification({ status: 'more_info_requested' });

            mockQuery
                .mockResolvedValueOnce({ rows: [verification] })
                .mockResolvedValueOnce({ rows: [updated] })
                .mockResolvedValueOnce({ rows: [{ email: 'mentor@example.com', first_name: 'Alice' }] });

            const result = await VerificationService.requestMoreInfo(
                'ver-uuid-1',
                'admin-uuid-1',
                'Please provide a clearer photo of your passport',
            );

            expect(result.status).toBe('more_info_requested');
            expect(mockEnqueueEmail).toHaveBeenCalledTimes(1);
        });

        it('throws if verification is not pending', async () => {
            const approved = makeVerification({ status: 'approved' });
            mockQuery.mockResolvedValueOnce({ rows: [approved] });

            await expect(
                VerificationService.requestMoreInfo('ver-uuid-1', 'admin-uuid-1', 'Need more docs'),
            ).rejects.toThrow('not pending');
        });
    });

    describe('flagExpiredVerifications', () => {
        it('flags expired verifications and clears is_verified', async () => {
            mockQuery
                .mockResolvedValueOnce({ rowCount: 3 })  // UPDATE expired
                .mockResolvedValueOnce({ rows: [] });     // UPDATE users

            const count = await VerificationService.flagExpiredVerifications();
            expect(count).toBe(3);

            const clearVerifiedCall = mockQuery.mock.calls.find(
                (c) => typeof c[0] === 'string' && c[0].includes('is_verified = FALSE'),
            );
            expect(clearVerifiedCall).toBeDefined();
        });

        it('returns 0 and skips user update when nothing expired', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 0 });

            const count = await VerificationService.flagExpiredVerifications();
            expect(count).toBe(0);
            expect(mockQuery).toHaveBeenCalledTimes(1);
        });
    });

    describe('getStatusByMentorId', () => {
        it('returns the latest verification record', async () => {
            const verification = makeVerification();
            mockQuery.mockResolvedValueOnce({ rows: [verification] });

            const result = await VerificationService.getStatusByMentorId('mentor-uuid-1');
            expect(result?.id).toBe('ver-uuid-1');
        });

        it('returns null when no record exists', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const result = await VerificationService.getStatusByMentorId('mentor-uuid-1');
            expect(result).toBeNull();
        });
    });
});
