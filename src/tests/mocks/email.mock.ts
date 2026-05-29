/**
 * Email Service Mock Factory
 * Provides mock implementations for email service operations
 */

export interface MockEmailOptions {
    to: string | string[];
    subject: string;
    template?: string;
    context?: Record<string, any>;
    html?: string;
    text?: string;
    attachments?: Array<{
        filename: string;
        content: string | Buffer;
        contentType?: string;
    }>;
}

export interface MockEmailResult {
    messageId: string;
    accepted: string[];
    rejected: string[];
    response: string;
}

/**
 * Create a mock email result
 */
export function createMockEmailResult(
    overrides: Partial<MockEmailResult> = {}
): MockEmailResult {
    return {
        messageId: 'mock_message_id_' + Math.random().toString(36).substring(7),
        accepted: Array.isArray(overrides.accepted) ? overrides.accepted : ['test@example.com'],
        rejected: [],
        response: '250 OK',
        ...overrides,
    };
}

/**
 * Create a mock email service
 */
export function createMockEmailService() {
    return {
        sendEmail: jest.fn(),
        sendWelcomeEmail: jest.fn(),
        sendVerificationEmail: jest.fn(),
        sendPasswordResetEmail: jest.fn(),
        sendBookingConfirmationEmail: jest.fn(),
        sendSessionReminderEmail: jest.fn(),
        sendPaymentReceivedEmail: jest.fn(),
        sendReviewReceivedEmail: jest.fn(),
        sendDisputeOpenedEmail: jest.fn(),
        sendAccountSuspendedEmail: jest.fn(),
        sendBulkEmail: jest.fn(),
        verifyConnection: jest.fn(),
        close: jest.fn(),
    };
}

/**
 * Mock email service module
 */
export function mockEmailServiceModule() {
    const mockService = createMockEmailService();

    jest.mock('../../services/email.service', () => ({
        EmailService: jest.fn().mockImplementation(() => mockService),
        emailService: mockService,
    }));

    return mockService;
}

/**
 * Setup common email service mock responses
 */
export function setupEmailServiceMocks(
    mockService: ReturnType<typeof createMockEmailService>
) {
    // Mock sendEmail
    mockService.sendEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendWelcomeEmail
    mockService.sendWelcomeEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendVerificationEmail
    mockService.sendVerificationEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendPasswordResetEmail
    mockService.sendPasswordResetEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendBookingConfirmationEmail
    mockService.sendBookingConfirmationEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendSessionReminderEmail
    mockService.sendSessionReminderEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendPaymentReceivedEmail
    mockService.sendPaymentReceivedEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendReviewReceivedEmail
    mockService.sendReviewReceivedEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendDisputeOpenedEmail
    mockService.sendDisputeOpenedEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendAccountSuspendedEmail
    mockService.sendAccountSuspendedEmail.mockResolvedValue(createMockEmailResult());

    // Mock sendBulkEmail
    mockService.sendBulkEmail.mockResolvedValue([createMockEmailResult()]);

    // Mock verifyConnection
    mockService.verifyConnection.mockResolvedValue(true);

    // Mock close
    mockService.close.mockResolvedValue(undefined);

    return mockService;
}

/**
 * Mock nodemailer module
 */
export function mockNodemailerModule() {
    const mockTransporter = {
        sendMail: jest.fn(),
        verify: jest.fn(),
        close: jest.fn(),
    };

    jest.mock('nodemailer', () => ({
        createTransport: jest.fn().mockReturnValue(mockTransporter),
    }));

    return mockTransporter;
}

/**
 * Setup nodemailer mock responses
 */
export function setupNodemailerMocks(
    mockTransporter: ReturnType<typeof mockNodemailerModule>
) {
    mockTransporter.sendMail.mockResolvedValue(createMockEmailResult());
    mockTransporter.verify.mockResolvedValue(true);
    mockTransporter.close.mockResolvedValue(undefined);

    return mockTransporter;
}
