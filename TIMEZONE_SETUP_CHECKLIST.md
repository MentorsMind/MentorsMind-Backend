# Timezone Implementation Setup Checklist

Use this checklist to integrate the timezone handling system into your application.

## ✅ Installation & Setup

### 1. Install Dependencies

```bash
npm install
```

**Verify**: Check that `luxon` and `cron` are in `node_modules/`

### 2. Run Database Migration

```bash
# Connect to your database
psql -d mentorminds -U your_username

# Run migration
\i database/migrations/003_add_timezone_support.sql

# Verify tables created
\dt sessions
\dt mentor_availability
\d users
```

**Verify**: 
- [ ] `users` table has `timezone` column
- [ ] `sessions` table exists with `reminded_24h` and `reminded_1h` columns
- [ ] `mentor_availability` table exists
- [ ] Indexes created successfully

### 3. Update Environment Variables (Optional)

Add to `.env` if needed:

```env
# Timezone settings (optional)
DEFAULT_TIMEZONE=UTC
REMINDER_CHECK_INTERVAL=*/5 * * * *  # Every 5 minutes
```

### 4. Initialize Reminder Service

Edit `src/server.ts`:

```typescript
import { reminderService } from './services/reminder.service';

// After database connection, before starting server
async function startServer() {
  try {
    // ... existing database connection code ...
    
    // Initialize reminder service
    await reminderService.initialize();
    console.log('✅ Reminder service initialized');
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  reminderService.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  reminderService.shutdown();
  process.exit(0);
});

startServer();
```

**Verify**: 
- [ ] Server starts without errors
- [ ] Console shows "Reminder service initialized"
- [ ] No database connection errors

## ✅ Testing

### 5. Run Unit Tests

```bash
# Run all tests
npm test

# Run timezone tests specifically
npm test -- timezone.utils.test.ts

# Run scheduler tests
npm test -- scheduler.utils.test.ts

# Run with coverage
npm test -- --coverage
```

**Verify**:
- [ ] All timezone tests pass (15+ tests)
- [ ] All scheduler tests pass (12+ tests)
- [ ] No TypeScript compilation errors

### 6. Test API Endpoints

```bash
# Start server
npm run dev

# In another terminal, test endpoints
curl http://localhost:5000/api/v1/timezones | jq

curl http://localhost:5000/api/v1/timezones/America%2FNew_York | jq
```

**Verify**:
- [ ] `/api/v1/timezones` returns list of timezones
- [ ] `/api/v1/timezones/:identifier` returns timezone details
- [ ] Response includes `offset` and `currentTime`

### 7. Test Timezone Utilities

Create a test file `test-timezone.ts`:

```typescript
import { localToUTC, utcToLocal, formatInTimezone, sessionsOverlap } from './src/utils/timezone.utils';

// Test 1: Convert local to UTC
const utc = localToUTC('2026-03-15T14:00:00', 'America/New_York');
console.log('UTC:', utc.toISO());

// Test 2: Convert UTC to local
const local = utcToLocal('2026-03-15T19:00:00Z', 'America/New_York');
console.log('Local:', local.toISO());

// Test 3: Format for display
const formatted = formatInTimezone('2026-03-15T19:00:00Z', 'America/New_York');
console.log('Formatted:', formatted);

// Test 4: Check overlap
const overlap = sessionsOverlap(
  { scheduledAt: '2026-03-15T14:00:00', durationMinutes: 60, timezone: 'America/New_York' },
  { scheduledAt: '2026-03-15T14:30:00', durationMinutes: 60, timezone: 'America/New_York' }
);
console.log('Overlap:', overlap);
```

Run: `npx ts-node test-timezone.ts`

**Verify**:
- [ ] No errors thrown
- [ ] UTC conversion works
- [ ] Formatting displays correctly
- [ ] Overlap detection works

## ✅ Integration

### 8. Update User Model

Add timezone field to user registration/profile:

```typescript
// In user registration
const newUser = {
  ...userData,
  timezone: req.body.timezone || 'UTC'
};

// Validate timezone
import { isValidIANATimezone } from './utils/timezone.utils';

if (req.body.timezone && !isValidIANATimezone(req.body.timezone)) {
  return res.status(400).json({ error: 'Invalid timezone' });
}
```

**Verify**:
- [ ] Users can set timezone during registration
- [ ] Timezone validation works
- [ ] Default timezone is UTC

### 9. Update Session Booking Endpoint

```typescript
import { localToUTC } from './utils/timezone.utils';
import { validateBooking } from './utils/scheduler.utils';
import { reminderService } from './services/reminder.service';

// POST /api/v1/bookings
async function createBooking(req, res) {
  // 1. Validate timezone
  if (!isValidIANATimezone(req.body.timezone)) {
    return res.status(400).json({ error: 'Invalid timezone' });
  }

  // 2. Convert to UTC
  const utcTime = localToUTC(req.body.scheduledAt, req.body.timezone);

  // 3. Validate booking
  const validation = validateBooking(
    {
      mentorId: req.body.mentorId,
      scheduledAt: req.body.scheduledAt,
      durationMinutes: req.body.durationMinutes,
      timezone: req.body.timezone
    },
    mentorAvailability,
    existingBookings
  );

  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  // 4. Create session
  const session = await db.query(
    'INSERT INTO sessions (mentor_id, mentee_id, scheduled_at_utc, duration_minutes, topic, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [req.body.mentorId, req.user.id, utcTime.toISO(), req.body.durationMinutes, req.body.topic, 'confirmed']
  );

  // 5. Schedule reminders
  await reminderService.scheduleForBooking(session.rows[0].id);

  res.json({ success: true, data: session.rows[0] });
}
```

**Verify**:
- [ ] Booking creation works
- [ ] Times stored in UTC
- [ ] Validation prevents invalid bookings
- [ ] Reminders scheduled

### 10. Update Session Display

```typescript
import { formatInTimezone } from './utils/timezone.utils';

// GET /api/v1/sessions
async function getSessions(req, res) {
  const sessions = await db.query(
    'SELECT * FROM sessions WHERE mentee_id = $1',
    [req.user.id]
  );

  const formatted = sessions.rows.map(session => ({
    ...session,
    scheduledAt: formatInTimezone(
      session.scheduled_at_utc,
      req.user.timezone,
      'EEEE, MMMM d \'at\' h:mm a zzz'
    ),
    scheduledAtISO: formatInTimezone(
      session.scheduled_at_utc,
      req.user.timezone
    )
  }));

  res.json({ success: true, data: formatted });
}
```

**Verify**:
- [ ] Sessions display in user's timezone
- [ ] Formatting is readable
- [ ] ISO format available for frontend

## ✅ Documentation

### 11. Review Documentation

Read through:
- [ ] [docs/timezone-handling.md](./docs/timezone-handling.md) - Complete guide
- [ ] [docs/dst-edge-cases.md](./docs/dst-edge-cases.md) - DST scenarios
- [ ] [docs/TIMEZONE_QUICK_REFERENCE.md](./docs/TIMEZONE_QUICK_REFERENCE.md) - Quick reference

### 12. Update API Documentation

Add to Swagger/OpenAPI docs:

```typescript
/**
 * @swagger
 * /api/v1/bookings:
 *   post:
 *     summary: Create session booking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mentorId
 *               - scheduledAt
 *               - durationMinutes
 *               - timezone
 *             properties:
 *               mentorId:
 *                 type: string
 *                 format: uuid
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 description: Local datetime (e.g., 2026-03-15T14:00:00)
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 15
 *                 maximum: 480
 *               timezone:
 *                 type: string
 *                 description: IANA timezone identifier
 *                 example: America/New_York
 */
```

**Verify**:
- [ ] API docs updated
- [ ] Timezone parameter documented
- [ ] Examples provided

## ✅ Production Readiness

### 13. Email/SMS Integration

Replace placeholder in `src/services/reminder.service.ts`:

```typescript
// Option 1: Nodemailer
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

private async sendNotification(userId: string, content: { subject: string; body: string }) {
  const user = await getUserById(userId);
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: content.subject,
    text: content.body
  });
}

// Option 2: SendGrid, Resend, AWS SES, etc.
```

**Verify**:
- [ ] Email service configured
- [ ] Test emails send successfully
- [ ] Reminders received

### 14. Monitoring & Logging

Add monitoring for reminder service:

```typescript
// In reminder.service.ts
private async checkAndScheduleReminders() {
  const startTime = Date.now();
  try {
    // ... existing code ...
    
    logger.info('Reminder check completed', {
      duration: Date.now() - startTime,
      reminders24h: sessions24h.length,
      reminders1h: sessions1h.length
    });
  } catch (error) {
    logger.error('Reminder check failed', { error, duration: Date.now() - startTime });
  }
}
```

**Verify**:
- [ ] Logs show reminder checks
- [ ] Errors logged properly
- [ ] Performance metrics tracked

### 15. Error Handling

Add error handling for edge cases:

```typescript
// In booking controller
try {
  const utcTime = localToUTC(req.body.scheduledAt, req.body.timezone);
} catch (error) {
  logger.error('Timezone conversion failed', { error, input: req.body });
  return res.status(400).json({ 
    error: 'Invalid datetime or timezone',
    details: error.message 
  });
}
```

**Verify**:
- [ ] Invalid timezones handled
- [ ] Invalid datetimes handled
- [ ] Errors logged

## ✅ Final Checks

### 16. Code Review Checklist

- [ ] All TypeScript errors resolved
- [ ] No console.log statements (use logger)
- [ ] Error handling in place
- [ ] Input validation complete
- [ ] Tests passing
- [ ] Documentation updated
- [ ] No hardcoded values
- [ ] Environment variables used

### 17. Performance Check

- [ ] Database indexes created
- [ ] Queries optimized
- [ ] Cron interval appropriate (5 minutes)
- [ ] No N+1 queries
- [ ] Connection pooling configured

### 18. Security Check

- [ ] Timezone validation in place
- [ ] SQL injection prevented (parameterized queries)
- [ ] Input sanitization
- [ ] No sensitive data in logs
- [ ] Rate limiting on API endpoints

## 🎉 Completion

Once all items are checked:

1. Commit changes:
```bash
git add .
git commit -m "feat: implement timezone handling and session reminders"
```

2. Create pull request with:
   - Link to this checklist
   - Test results
   - Screenshots of API responses
   - Migration script

3. Deploy to staging:
   - Run migration
   - Test end-to-end
   - Verify reminders send

4. Monitor:
   - Check logs for errors
   - Verify reminders sending
   - Monitor database performance

## 📞 Support

If you encounter issues:

1. Check [docs/timezone-handling.md](./docs/timezone-handling.md)
2. Review [docs/TIMEZONE_QUICK_REFERENCE.md](./docs/TIMEZONE_QUICK_REFERENCE.md)
3. See [docs/dst-edge-cases.md](./docs/dst-edge-cases.md)
4. Check logs for errors
5. Create GitHub issue with:
   - Error message
   - Steps to reproduce
   - Environment details

## 🚀 Next Steps

After timezone implementation:

- [ ] Integrate with Session Booking API (Issue #B8)
- [ ] Upgrade to BullMQ (Issue #B29)
- [ ] Add SMS reminders
- [ ] Implement session rescheduling
- [ ] Add timezone conflict warnings

---

**Status**: Ready for integration  
**Last Updated**: March 24, 2026
