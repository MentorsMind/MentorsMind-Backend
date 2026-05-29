# Email Notification System Implementation

## Overview

This document describes the implementation of the templated email notification system for MentorMinds Backend. The system uses Handlebars templates with a base layout for consistent branding across all transactional emails.

## Architecture

### Components

1. **Base Layout Template** (`src/templates/emails/base-layout.hbs`)
   - Provides consistent branding with logo, footer, and unsubscribe links
   - Responsive design for mobile and desktop
   - Social media links and legal information

2. **Email Templates** (Handlebars `.hbs` files)
   - Welcome email
   - Email verification
   - Password reset
   - Booking confirmed
   - Session reminder (24h and 15min)
   - Payment received
   - Review received
   - Dispute opened
   - Account suspended

3. **Email Service** (`src/services/email.service.ts`)
   - Nodemailer with SMTP transport
   - Multiple provider support with circuit breaker pattern
   - HTML and plain-text fallback for every template

4. **Email Queue** (`src/jobs/emailQueue.job.ts`)
   - BullMQ for job queuing
   - Exponential backoff retry (3 attempts: 1s → 2s → 4s)
   - Comprehensive logging of all send attempts

5. **Admin Preview Endpoint** (`POST /api/v1/admin/email/preview/:template`)
   - Preview rendered templates with sample data
   - Useful for testing and debugging

## Email Templates

### Available Templates

| Template Name | Description | Key Variables |
|--------------|-------------|---------------|
| `welcome` | New user registration | `userName`, `platformUrl` |
| `email-verification` | Email verification link | `userName`, `verificationUrl` |
| `password-reset` | Password reset link | `userName`, `resetUrl` |
| `booking-confirmed` | Booking confirmation | `userName`, `mentorName`, `sessionDate`, `sessionTime`, `duration`, `amount`, `meetingUrl` |
| `session-reminder-24h` | 24-hour session reminder | `userName`, `mentorName`, `sessionDate`, `sessionTime`, `duration`, `meetingUrl` |
| `session-reminder-15min` | 15-minute session reminder | `userName`, `mentorName`, `sessionTime`, `duration`, `meetingUrl` |
| `payment-received` | Payment confirmation | `userName`, `amount`, `transactionId`, `paymentDate`, `description` |
| `review-received` | New review notification | `userName`, `reviewerName`, `rating`, `sessionTopic`, `reviewDate`, `reviewComment` |
| `dispute-opened` | Dispute notification | `userName`, `disputeId`, `sessionTopic`, `amount`, `filedByName`, `disputeDate`, `reason` |
| `account-suspended` | Account suspension notice | `userName`, `reason`, `suspensionDate`, `duration`, `details` |

### Template Structure

All templates use the base layout and follow this structure:

```handlebars
{{#> base-layout}}
{{#*inline "content"}}
<!-- Template-specific content here -->
{{/inline}}
{{/base-layout}}
```

## Configuration

### Environment Variables

```env
# SMTP Configuration
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-password

# Gmail (optional fallback)
GMAIL_USER=your-gmail@gmail.com
GMAIL_PASS=your-app-password

# From Email
FROM_EMAIL=noreply@mentorminds.com
```

### Queue Configuration

The email queue is configured with:
- **Retry attempts**: 3
- **Backoff**: Exponential (1s → 2s → 4s)
- **Concurrency**: 10 concurrent email jobs
- **Redis**: Required for BullMQ

## Usage

### Sending Emails

Emails are automatically queued via BullMQ. Never send emails inline in request handlers.

```typescript
import { enqueueEmail } from '../jobs/emailQueue.job';

await enqueueEmail({
  to: ['user@example.com'],
  subject: 'Welcome to MentorMinds',
  templateId: 'welcome',
  templateData: {
    userName: 'John Doe',
    platformUrl: 'https://mentorminds.com',
  },
  templateName: 'welcome',
  recipient: 'user@example.com',
});
```

### Admin Preview Endpoint

Preview any email template with sample data:

```bash
POST /api/v1/admin/email/preview/welcome
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "userName": "John Doe",
  "platformUrl": "https://mentorminds.com"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "template": "welcome",
    "subject": "Welcome to MentorMinds",
    "html": "<!DOCTYPE html>...",
    "text": "Welcome to MentorMinds, John Doe!...",
    "sampleData": {
      "userName": "John Doe",
      "platformUrl": "https://mentorminds.com"
    }
  }
}
```

## Logging

All email send attempts are logged with:
- Job ID
- Template name
- Recipient
- Subject
- Attempt number
- Success/failure status
- Error details (if failed)

Example log:
```json
{
  "level": "info",
  "message": "Email job completed successfully",
  "jobId": "123",
  "templateName": "welcome",
  "recipient": "user@example.com",
  "subject": "Welcome to MentorMinds",
  "attempt": 1,
  "maxAttempts": 3,
  "messageId": "<message-id@example.com>",
  "deliveryStatus": "SENT"
}
```

## Error Handling

### Retry Logic

Failed emails are automatically retried up to 3 times with exponential backoff:
1. First retry: 1 second delay
2. Second retry: 2 seconds delay
3. Third retry: 4 seconds delay

### Circuit Breaker

The email service implements a circuit breaker pattern:
- After 5 consecutive failures, a provider is marked as unhealthy
- The circuit breaker resets after 5 minutes
- Automatic failover to next healthy provider

## Testing

### Unit Tests

Run email service tests:
```bash
npm test -- src/services/__tests__/email.service.test.ts
```

### Integration Tests

Test email queue and worker:
```bash
npm test -- src/__tests__/jobs/emailQueue.job.test.ts
```

### Manual Testing

Use the admin preview endpoint to test templates:
```bash
curl -X POST http://localhost:5000/api/v1/admin/email/preview/welcome \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"userName": "Test User"}'
```

## File Structure

```
src/
├── templates/
│   └── emails/
│       ├── base-layout.hbs          # Base layout with branding
│       ├── welcome.hbs              # Welcome email
│       ├── email-verification.hbs   # Email verification
│       ├── password-reset.hbs       # Password reset
│       ├── booking-confirmed.hbs    # Booking confirmation
│       ├── session-reminder-24h.hbs # 24-hour reminder
│       ├── session-reminder-15min.hbs # 15-minute reminder
│       ├── payment-received.hbs     # Payment confirmation
│       ├── review-received.hbs      # Review notification
│       ├── dispute-opened.hbs       # Dispute notification
│       └── account-suspended.hbs    # Account suspension
├── services/
│   ├── email.service.ts             # Email service with nodemailer
│   └── template-engine.service.ts   # Template rendering engine
├── jobs/
│   └── emailQueue.job.ts            # BullMQ email queue worker
├── controllers/
│   └── admin.controller.ts          # Admin preview endpoint
└── routes/
    └── admin.routes.ts              # Admin routes including preview
```

## Acceptance Criteria Status

- ✅ Create base email layout with MentorMinds branding (logo, footer, unsubscribe link)
- ✅ Templates for: welcome, email verification, password reset, booking confirmed, session reminder (24h + 15min), payment received, review received, dispute opened, account suspended
- ✅ Use nodemailer with SMTP transport (configurable via env)
- ✅ Support HTML + plain-text fallback for every template
- ✅ POST /api/v1/admin/email/preview/:template — admin endpoint to preview rendered template
- ✅ Queue all emails via BullMQ (never send inline in request handler)
- ✅ Retry failed sends up to 3 times with exponential backoff
- ✅ Log every send attempt (success/failure) with recipient and template name

## Future Enhancements

1. **Template Versioning**: Store template versions in database for A/B testing
2. **Email Analytics**: Track open rates, click rates, and bounce rates
3. **Dynamic Content**: Support for conditional content blocks
4. **Localization**: Multi-language template support
5. **Attachment Support**: Add file attachments to emails
6. **Scheduled Emails**: Support for delayed email delivery
7. **Template Editor**: Web-based template editor for admins

## Troubleshooting

### Emails Not Sending

1. Check SMTP configuration in environment variables
2. Verify Redis is running (required for BullMQ)
3. Check email worker logs for errors
4. Verify email queue is not paused

### Template Rendering Errors

1. Ensure all required template variables are provided
2. Check template syntax for Handlebars errors
3. Verify template file exists in `src/templates/emails/`

### Queue Backlog

1. Check Redis memory usage
2. Increase worker concurrency if needed
3. Monitor failed jobs in BullMQ dashboard

## Support

For issues or questions, contact the development team or refer to:
- Nodemailer documentation: https://nodemailer.com/
- BullMQ documentation: https://docs.bullmq.io/
- Handlebars documentation: https://handlebarsjs.com/
