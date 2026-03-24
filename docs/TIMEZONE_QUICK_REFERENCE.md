# Timezone Quick Reference

## Installation

```bash
npm install
```

New dependencies: `luxon`, `cron`, `@types/luxon`, `@types/cron`

## Common Operations

### Validate Timezone

```typescript
import { isValidIANATimezone } from './utils/timezone.utils';

if (!isValidIANATimezone(req.body.timezone)) {
  return res.status(400).json({ error: 'Invalid timezone' });
}
```

### Convert Local → UTC (for storage)

```typescript
import { localToUTC } from './utils/timezone.utils';

const utcTime = localToUTC(
  req.body.scheduledAt,  // '2026-03-15T14:00:00'
  req.body.timezone      // 'America/New_York'
);

await db.query(
  'INSERT INTO sessions (scheduled_at_utc) VALUES ($1)',
  [utcTime.toISO()]
);
```

### Convert UTC → Local (for display)

```typescript
import { formatInTimezone } from './utils/timezone.utils';

const displayTime = formatInTimezone(
  session.scheduled_at_utc,  // '2026-03-15T19:00:00Z'
  user.timezone              // 'America/New_York'
);
// Returns: "Sunday, March 15, 2026 at 14:00 EDT"
```

### Check Session Overlap

```typescript
import { sessionsOverlap } from './utils/timezone.utils';

const overlap = sessionsOverlap(
  {
    scheduledAt: '2026-03-15T14:00:00',
    durationMinutes: 60,
    timezone: 'America/New_York'
  },
  {
    scheduledAt: '2026-03-15T14:30:00',
    durationMinutes: 60,
    timezone: 'America/New_York'
  }
);
// Returns: true (30-minute overlap)
```

### Validate Booking

```typescript
import { validateBooking } from './utils/scheduler.utils';

const result = validateBooking(
  {
    mentorId: 'mentor-123',
    scheduledAt: '2026-03-20T14:00:00',
    durationMinutes: 60,
    timezone: 'America/New_York'
  },
  mentorAvailability,
  existingBookings
);

if (!result.valid) {
  return res.status(400).json({ error: result.message });
}
```

### Generate Recurring Slots

```typescript
import { generateWeeklySlots } from './utils/scheduler.utils';

const slots = generateWeeklySlots(
  {
    days: [1, 3, 5],      // Mon, Wed, Fri
    startTime: '09:00',
    endTime: '17:00',
    timezone: 'America/New_York'
  },
  '2026-03-16'  // Monday of week
);
```

### Initialize Reminders

```typescript
import { reminderService } from './services/reminder.service';

// In app startup (server.ts)
await reminderService.initialize();

// After creating booking
await reminderService.scheduleForBooking(sessionId);
```

## API Endpoints

### List Timezones

```bash
GET /api/v1/timezones

Response:
{
  "success": true,
  "data": [
    {
      "identifier": "America/New_York",
      "offset": "UTC-05:00",
      "currentTime": "2026-03-24T10:30:00-05:00"
    }
  ]
}
```

### Get Timezone Details

```bash
GET /api/v1/timezones/America%2FNew_York

Response:
{
  "success": true,
  "data": {
    "identifier": "America/New_York",
    "offset": "UTC-05:00",
    "currentTime": "2026-03-24T10:30:00-05:00",
    "currentTimeFormatted": "Tuesday, March 24, 2026 at 10:30:00 AM EDT",
    "isDST": true
  }
}
```

## Database Schema

```sql
-- Add to users table
ALTER TABLE users ADD COLUMN timezone VARCHAR(50) DEFAULT 'UTC';

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES users(id),
  mentee_id UUID NOT NULL REFERENCES users(id),
  scheduled_at_utc TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL,
  topic VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  reminded_24h TIMESTAMP WITH TIME ZONE,
  reminded_1h TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_scheduled_at ON sessions(scheduled_at_utc);
```

## Testing

```bash
# Run all tests
npm test

# Run timezone tests
npm test -- timezone.utils.test.ts

# Run scheduler tests
npm test -- scheduler.utils.test.ts
```

## Common Patterns

### Booking Creation

```typescript
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

// 4. Store in database
const session = await db.query(
  'INSERT INTO sessions (mentor_id, mentee_id, scheduled_at_utc, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING *',
  [req.body.mentorId, req.user.id, utcTime.toISO(), req.body.durationMinutes]
);

// 5. Schedule reminders
await reminderService.scheduleForBooking(session.rows[0].id);
```

### Display Session to User

```typescript
const sessions = await db.query(
  'SELECT * FROM sessions WHERE mentee_id = $1',
  [userId]
);

const formatted = sessions.rows.map(session => ({
  ...session,
  scheduledAt: formatInTimezone(
    session.scheduled_at_utc,
    user.timezone,
    'EEEE, MMMM d \'at\' h:mm a zzz'
  )
}));
```

## Troubleshooting

### "Invalid IANA timezone"
Use full identifier: `America/New_York` not `EST`

### Sessions overlap unexpectedly
Use `sessionsOverlap()` - it handles DST and cross-timezone comparisons

### Reminders not sending
1. Check `reminderService.initialize()` was called
2. Verify database has `reminded_24h` and `reminded_1h` columns
3. Check logs for cron job execution

### DST causing issues
Always convert to UTC for storage and comparison. Use Luxon functions, not manual offset calculations.

## Best Practices

✅ **DO**
- Store all times in UTC
- Validate timezone input
- Use `sessionsOverlap()` for comparisons
- Store duration in minutes, not end time
- Use Luxon for all date math

❌ **DON'T**
- Store local times in database
- Compare local times directly
- Use timezone abbreviations (EST, PST)
- Calculate offsets manually
- Ignore DST transitions

## Resources

- [Full Documentation](./timezone-handling.md)
- [DST Edge Cases](./dst-edge-cases.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [Luxon Docs](https://moment.github.io/luxon/)
