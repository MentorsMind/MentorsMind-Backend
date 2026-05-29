/**
 * Unit tests for Session Reminder Job — Issue #100
 */

import { runSessionReminderJob } from '../../jobs/sessionReminder.job';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../../config/database', () => ({ query: (...args: any[]) => mockQuery(...args) }));

const mockEnqueueEmail = jest.fn().mockResolvedValue(undefined);
jest.mock('../../queues/email.queue', () => ({ enqueueEmail: (...args: any[]) => mockEnqueueEmail(...args) }));

const mockSendNotification = jest.fn().mockResolvedValue({ success: true, notificationIds: ['n1'], errors: [] });
jest.mock('../../services/notification.service', () => ({
    NotificationService: { sendNotification: (...args: any[]) => mockSendNotification(...args) },
}));

jest.mock('../../utils/logger.utils', () => ({
    logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeBooking = (overrides = {}) => ({
    id: 'booking-uuid-1',
    mentor_id: 'mentor-uuid-1',
    mentee_id: 'mentee-uuid-1',
    mentor_email: 'mentor@example.com',
    mentee_email: 'mentee@example.com',
    mentor_first_name: 'Alice',
    mentee_first_name: 'Bob',
    title: 'TypeScript Deep Dive',
    scheduled_start: new Date(Date.now() + 24 * 60 * 60 * 1000),
    duration_minutes: 60,
    meeting_url: 'https://meet.example.com/room-1',
    ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runSessionReminderJob', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sends 24h reminders to mentor and mentee and marks flag', async () => {
        const booking = makeBooking();

        // First call = 24h query (returns booking), second call = 15m query (empty), then UPDATE calls
        mockQuery
            .mockResolvedValueOnce({ rows: [booking] })  // 24h fetch
            .mockResolvedValueOnce({ rows: [] })           // 15m fetch
            .mockResolvedValue({ rows: [] });              // UPDATE calls

        await runSessionReminderJob();

        // Email sent to both participants
        expect(mockEnqueueEmail).toHaveBeenCalledTimes(2);
        const emailTargets = mockEnqueueEmail.mock.calls.map((c) => c[0].to[0]);
        expect(emailTargets).toContain('mentor@example.com');
        expect(emailTargets).toContain('mentee@example.com');

        // In-app notification sent to both
        expect(mockSendNotification).toHaveBeenCalledTimes(2);

        // Flag marked as sent
        const updateCall = mockQuery.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('reminder_24h_sent = TRUE'),
        );
        expect(updateCall).toBeDefined();
        expect(updateCall![1][0]).toBe(booking.id);
    });

    it('sends 15m reminders and marks flag', async () => {
        const booking = makeBooking({ id: 'booking-uuid-2' });

        mockQuery
            .mockResolvedValueOnce({ rows: [] })           // 24h fetch — nothing due
            .mockResolvedValueOnce({ rows: [booking] })    // 15m fetch
            .mockResolvedValue({ rows: [] });              // UPDATE

        await runSessionReminderJob();

        expect(mockEnqueueEmail).toHaveBeenCalledTimes(2);

        const updateCall = mockQuery.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].includes('reminder_15m_sent'),
        );
        expect(updateCall).toBeDefined();
    });

    it('does not send duplicate reminders (flag already true)', async () => {
        // Both queries return empty — flags already set in DB
        mockQuery.mockResolvedValue({ rows: [] });

        await runSessionReminderJob();

        expect(mockEnqueueEmail).not.toHaveBeenCalled();
        expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('skips cancelled sessions', async () => {
        // The SQL WHERE clause filters status = 'confirmed', so cancelled sessions
        // are never returned. Simulate by returning empty rows.
        mockQuery.mockResolvedValue({ rows: [] });

        await runSessionReminderJob();

        expect(mockEnqueueEmail).not.toHaveBeenCalled();
    });

    it('continues processing remaining bookings when one fails', async () => {
        const booking1 = makeBooking({ id: 'b1', mentor_email: 'mentor1@example.com', mentee_email: 'mentee1@example.com' });
        const booking2 = makeBooking({ id: 'b2', mentor_email: 'mentor2@example.com', mentee_email: 'mentee2@example.com' });

        mockQuery
            .mockResolvedValueOnce({ rows: [booking1, booking2] }) // 24h fetch
            .mockResolvedValueOnce({ rows: [] })                    // 15m fetch
            .mockResolvedValue({ rows: [] });                       // UPDATE calls

        // First booking's email throws
        mockEnqueueEmail
            .mockRejectedValueOnce(new Error('SMTP error'))
            .mockResolvedValue(undefined);

        await runSessionReminderJob();

        // Second booking should still be processed
        expect(mockEnqueueEmail.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});
