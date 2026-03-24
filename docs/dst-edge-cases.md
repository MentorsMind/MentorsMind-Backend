# DST Edge Cases Guide

## Overview

Daylight Saving Time (DST) transitions can cause unexpected behavior in scheduling systems. This guide covers common edge cases and how MentorMinds handles them.

## DST Transition Types

### Spring Forward (Clock Moves Ahead)

In most regions observing DST, clocks "spring forward" by 1 hour in March/April.

**Example:** March 9, 2026 at 2:00 AM → 3:00 AM (America/New_York)

The hour from 2:00 AM to 3:00 AM doesn't exist on this day.

### Fall Back (Clock Moves Back)

Clocks "fall back" by 1 hour in October/November.

**Example:** November 1, 2026 at 2:00 AM → 1:00 AM (America/New_York)

The hour from 1:00 AM to 2:00 AM occurs twice on this day.

## Edge Cases

### 1. Booking During Non-Existent Hour (Spring Forward)

**Scenario:** User tries to book a session at 2:30 AM on March 9, 2026 (EST → EDT transition)

**Problem:** This time doesn't exist (clock jumps from 2:00 AM to 3:00 AM)

**Solution:** Luxon automatically adjusts to the next valid time (3:30 AM EDT)

```typescript
import { localToUTC } from './utils/timezone.utils';

// User input: 2:30 AM on DST transition day
const utc = localToUTC('2026-03-09T02:30:00', 'America/New_York');
console.log(utc.toISO()); // Automatically adjusted to valid time
```

### 2. Booking During Ambiguous Hour (Fall Back)

**Scenario:** User books at 1:30 AM on November 1, 2026 (EDT → EST transition)

**Problem:** This time occurs twice (once in EDT, once in EST)

**Solution:** Luxon defaults to the first occurrence (before DST ends)

```typescript
const utc = localToUTC('2026-11-01T01:30:00', 'America/New_York');
// Uses first occurrence (EDT, UTC-4)
```

### 3. Session Spanning DST Transition

**Scenario:** Session starts at 1:00 AM, lasts 2 hours, spans fall-back transition

**Problem:** Session duration appears to be 3 hours in local time

**Solution:** Store duration in minutes, not end time. Calculate end time dynamically.

```typescript
// ✅ Correct
const session = {
  scheduledAt: '2026-11-01T01:00:00',
  durationMinutes: 120, // Always 120 minutes
  timezone: 'America/New_York'
};

// Calculate end time
const start = localToUTC(session.scheduledAt, session.timezone);
const end = start.plus({ minutes: session.durationMinutes });
// End time is correctly 2 hours later in UTC
```

### 4. Recurring Availability Across DST

**Scenario:** Mentor available "9 AM - 5 PM EST" every Monday

**Problem:** After DST transition, "9 AM" shifts by 1 hour in UTC

**Solution:** Store availability in local time, convert to UTC on each occurrence

```typescript
import { generateWeeklySlots } from './utils/scheduler.utils';

const pattern = {
  days: [1], // Monday
  startTime: '09:00', // Local time
  endTime: '17:00',
  timezone: 'America/New_York'
};

// Generates slots with correct UTC times for each week
const beforeDST = generateWeeklySlots(pattern, '2026-03-02'); // EST
const afterDST = generateWeeklySlots(pattern, '2026-03-16'); // EDT
// UTC times differ by 1 hour, but local times are consistent
```

### 5. Cross-Timezone Overlap During DST

**Scenario:** 
- Mentor (New York) available 2:00 PM - 3:00 PM EST
- Learner (London) books 7:00 PM - 8:00 PM GMT
- DST transitions happen on different dates

**Problem:** Overlap detection must account for both timezones' DST rules

**Solution:** Always convert to UTC for comparison

```typescript
import { sessionsOverlap } from './utils/timezone.utils';

const mentorSession = {
  scheduledAt: '2026-03-15T14:00:00',
  durationMinutes: 60,
  timezone: 'America/New_York' // EDT (UTC-4)
};

const learnerSession = {
  scheduledAt: '2026-03-15T19:00:00',
  durationMinutes: 60,
  timezone: 'Europe/London' // GMT (UTC+0)
};

// Correctly detects overlap by comparing UTC times
const overlaps = sessionsOverlap(mentorSession, learnerSession);
```

### 6. Reminder Timing During DST

**Scenario:** Session at 2:30 AM on DST transition day, 24h reminder scheduled

**Problem:** "24 hours before" is ambiguous during fall-back (25 hours in local time)

**Solution:** Calculate reminders in UTC, display in local time

```typescript
// Session scheduled for 2026-11-01T02:30:00 EST (after fall-back)
const sessionUTC = localToUTC('2026-11-01T02:30:00', 'America/New_York');

// 24h reminder
const reminder24h = sessionUTC.minus({ hours: 24 });
// Correctly 24 hours before in UTC, regardless of DST
```

## Testing DST Edge Cases

### Test Spring Forward

```typescript
describe('DST Spring Forward', () => {
  it('should handle non-existent hour', () => {
    // 2:30 AM doesn't exist on March 9, 2026
    const utc = localToUTC('2026-03-09T02:30:00', 'America/New_York');
    expect(utc.isValid).toBe(true);
    // Luxon adjusts to valid time
  });

  it('should maintain session duration', () => {
    const session = {
      scheduledAt: '2026-03-09T01:30:00', // Before DST
      durationMinutes: 60,
      timezone: 'America/New_York'
    };
    
    const start = localToUTC(session.scheduledAt, session.timezone);
    const end = start.plus({ minutes: 60 });
    
    // Duration is exactly 60 minutes in UTC
    expect(end.diff(start, 'minutes').minutes).toBe(60);
  });
});
```

### Test Fall Back

```typescript
describe('DST Fall Back', () => {
  it('should handle ambiguous hour', () => {
    // 1:30 AM occurs twice on November 1, 2026
    const utc = localToUTC('2026-11-01T01:30:00', 'America/New_York');
    expect(utc.isValid).toBe(true);
    // Uses first occurrence (EDT)
  });

  it('should detect overlap during ambiguous hour', () => {
    const session1 = {
      scheduledAt: '2026-11-01T01:00:00',
      durationMinutes: 120,
      timezone: 'America/New_York'
    };
    
    const session2 = {
      scheduledAt: '2026-11-01T01:30:00',
      durationMinutes: 60,
      timezone: 'America/New_York'
    };
    
    expect(sessionsOverlap(session1, session2)).toBe(true);
  });
});
```

### Test Cross-Timezone DST

```typescript
describe('Cross-Timezone DST', () => {
  it('should handle different DST transition dates', () => {
    // US DST: March 9, 2026
    // EU DST: March 30, 2026
    
    const usSession = {
      scheduledAt: '2026-03-15T14:00:00',
      durationMinutes: 60,
      timezone: 'America/New_York' // EDT
    };
    
    const euSession = {
      scheduledAt: '2026-03-15T19:00:00',
      durationMinutes: 60,
      timezone: 'Europe/Paris' // Still CET (not CEST yet)
    };
    
    // Should correctly compare despite different DST states
    const overlaps = sessionsOverlap(usSession, euSession);
    expect(typeof overlaps).toBe('boolean');
  });
});
```

## Best Practices

### 1. Never Store Local Times

```typescript
// ❌ Wrong
await db.query(
  'INSERT INTO sessions (scheduled_at) VALUES ($1)',
  ['2026-03-09T02:30:00'] // Local time, ambiguous
);

// ✅ Correct
const utc = localToUTC('2026-03-09T02:30:00', 'America/New_York');
await db.query(
  'INSERT INTO sessions (scheduled_at_utc) VALUES ($1)',
  [utc.toISO()]
);
```

### 2. Store Duration, Not End Time

```typescript
// ❌ Wrong
const session = {
  start: '2026-11-01T01:00:00',
  end: '2026-11-01T03:00:00', // Ambiguous during fall-back
  timezone: 'America/New_York'
};

// ✅ Correct
const session = {
  scheduledAt: '2026-11-01T01:00:00',
  durationMinutes: 120, // Unambiguous
  timezone: 'America/New_York'
};
```

### 3. Use Luxon for All Date Math

```typescript
// ❌ Wrong
const endTime = new Date(startTime.getTime() + (60 * 60 * 1000));
// Doesn't account for DST

// ✅ Correct
const endTime = startTime.plus({ hours: 1 });
// Luxon handles DST automatically
```

### 4. Test Around DST Transitions

Always test your scheduling logic with dates near DST transitions:
- Week before DST
- Day of DST transition
- Week after DST

## Debugging DST Issues

### Check Timezone Offset

```typescript
import { getTimezoneOffset } from './utils/timezone.utils';

console.log(getTimezoneOffset('America/New_York'));
// Before DST: UTC-05:00
// After DST: UTC-04:00
```

### Find Next DST Transition

```typescript
import { nextDSTTransition } from './utils/timezone.utils';

const transition = nextDSTTransition('America/New_York');
if (transition) {
  console.log(`Next DST change: ${transition.date.toISO()}`);
  console.log(`New offset: ${transition.offset} minutes`);
}
```

### Verify UTC Conversion

```typescript
import { localToUTC, utcToLocal } from './utils/timezone.utils';

const local = '2026-03-09T02:30:00';
const tz = 'America/New_York';

const utc = localToUTC(local, tz);
const backToLocal = utcToLocal(utc.toISO()!, tz);

console.log('Original:', local);
console.log('UTC:', utc.toISO());
console.log('Back to local:', backToLocal.toISO());
```

## Resources

- [IANA Timezone Database](https://www.iana.org/time-zones)
- [Luxon DST Documentation](https://moment.github.io/luxon/#/zones)
- [DST Transition Dates by Country](https://www.timeanddate.com/time/dst/)
- [PostgreSQL Timezone Handling](https://www.postgresql.org/docs/current/datatype-datetime.html#DATATYPE-TIMEZONES)
