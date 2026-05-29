# Database Migration Instructions

## Current Status

The notification system has been fully implemented with all required files created. However, the database migration needs to be run to create the notifications table.

## Migration File

**Location**: `database/migrations/014_create_notifications.sql`

This migration creates:
- `notification_type` ENUM with 12 notification types
- `notifications` table with proper schema
- 6 indexes for optimal query performance

## How to Run the Migration

### Option 1: Using PostgreSQL Command Line (psql)

If you have PostgreSQL installed locally:

```bash
# Connect to your database
psql -h localhost -p 5432 -U postgres -d mentorminds

# Run the migration
\i database/migrations/014_create_notifications.sql

# Verify the table was created
\dt notifications
\d notifications
```

### Option 2: Using Docker

If you're using Docker for PostgreSQL:

```bash
# Start your Docker containers
docker-compose up -d

# Run the migration
docker-compose exec db psql -U user -d mentorsmind -f /path/to/migrations/014_create_notifications.sql

# Or copy the file and run it
docker cp database/migrations/014_create_notifications.sql mentorsmind-db:/tmp/
docker-compose exec db psql -U user -d mentorsmind -f /tmp/014_create_notifications.sql
```

### Option 3: Using a Database GUI Tool

If you're using a GUI tool like pgAdmin, DBeaver, or TablePlus:

1. Open your database connection
2. Open a new SQL query window
3. Copy the contents of `database/migrations/014_create_notifications.sql`
4. Execute the SQL script

### Option 4: Using Node.js Migration Script

Create a simple Node.js script to run the migration:

```javascript
// run-migration.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'mentorminds',
  user: 'postgres',
  password: 'your_password'
});

async function runMigration() {
  const sql = fs.readFileSync(
    path.join(__dirname, 'database/migrations/014_create_notifications.sql'),
    'utf8'
  );
  
  try {
    await pool.query(sql);
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await pool.end();
  }
}

runMigration();
```

Then run:
```bash
node run-migration.js
```

### Option 5: Manual SQL Execution

Copy and paste this SQL directly into your database:

```sql
-- Create notification_type ENUM
CREATE TYPE notification_type AS ENUM (
    'session_booked',
    'session_confirmed',
    'session_cancelled',
    'session_reminder',
    'payment_received',
    'payment_failed',
    'review_received',
    'escrow_released',
    'dispute_opened',
    'meeting_confirmed',
    'message_received',
    'system_alert'
);

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

-- Add comments
COMMENT ON TABLE notifications IS 'In-app notifications for platform events';
COMMENT ON COLUMN notifications.data IS 'Additional notification metadata (e.g., booking_id, payment_id)';
COMMENT ON COLUMN notifications.is_read IS 'Whether the user has read this notification';
```

## Verification

After running the migration, verify it was successful:

```sql
-- Check if table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'notifications';

-- Check table structure
\d notifications

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'notifications';

-- Test insert
INSERT INTO notifications (user_id, type, title, message, data)
VALUES (
  (SELECT id FROM users LIMIT 1),
  'system_alert',
  'Test Notification',
  'This is a test notification',
  '{"test": true}'::jsonb
);

-- Verify insert
SELECT * FROM notifications;
```

## Next Steps After Migration

1. **Restart your application** - The notification cleanup service will initialize automatically

2. **Test the API endpoints**:
   ```bash
   # Get notifications
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        http://localhost:3000/api/v1/notifications
   
   # Get unread count
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        http://localhost:3000/api/v1/notifications/unread-count
   ```

3. **Test WebSocket events**:
   ```javascript
   const socket = io('http://localhost:3000', {
     auth: { token: 'YOUR_JWT_TOKEN' }
   });
   
   socket.on('notification:new', (data) => {
     console.log('New notification:', data);
   });
   ```

4. **Create test notifications**:
   ```typescript
   import { NotificationService } from './services/notification.service';
   
   await NotificationService.create('user-id', 'session_booked', {
     title: 'Test Notification',
     message: 'This is a test',
     data: { test: true }
   });
   ```

## Troubleshooting

### Error: relation "users" does not exist

Make sure you've run all previous migrations first. The notifications table has a foreign key to the users table.

### Error: type "notification_type" already exists

The ENUM type already exists. You can skip creating it or drop it first:
```sql
DROP TYPE IF EXISTS notification_type CASCADE;
```

### Error: permission denied

Make sure your database user has CREATE privileges:
```sql
GRANT CREATE ON DATABASE mentorminds TO your_user;
```

## Database Setup (If Not Done Yet)

If you haven't set up your database yet:

1. **Install PostgreSQL** (if not using Docker):
   - Windows: Download from https://www.postgresql.org/download/windows/
   - Mac: `brew install postgresql`
   - Linux: `sudo apt-get install postgresql`

2. **Create the database**:
   ```sql
   CREATE DATABASE mentorminds;
   ```

3. **Run all migrations in order**:
   ```bash
   001_create_users.sql
   002_create_wallets.sql
   003_create_transactions.sql
   004_create_bookings.sql
   005_create_reviews.sql
   006_create_indexes.sql
   007_create_triggers.sql
   008_create_refresh_tokens.sql
   009_add_indexes.sql
   010_create_disputes.sql
   011_create_learner_goals.sql
   012_add_meeting_url_to_sessions.sql
   013_query_optimization.sql
   014_create_notifications.sql  ← New migration
   ```

## Summary

The notification system is fully implemented and ready to use. Once you run the migration, all features will be available:

- ✅ API endpoints for managing notifications
- ✅ WebSocket real-time delivery
- ✅ Auto-cleanup cron job (runs daily at 2:00 AM)
- ✅ Complete documentation and examples

For detailed usage instructions, see:
- `docs/notifications-api.md` - API documentation
- `NOTIFICATIONS_QUICK_REFERENCE.md` - Quick reference
- `docs/notification-integration-examples.md` - Integration examples
