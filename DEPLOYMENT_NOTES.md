# Deployment Notes - Notification System

## 🚀 What's New

This release adds a centralized notification system with real-time WebSocket delivery.

## ⚠️ Required Actions Before Deployment

### 1. Run Database Migration

**Migration File**: `database/migrations/014_create_notifications.sql`

```bash
# Option A: Using psql
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f database/migrations/014_create_notifications.sql

# Option B: Using Docker
docker-compose exec db psql -U user -d mentorsmind -f /path/to/014_create_notifications.sql

# Option C: Using your migration tool
./database/migrate.sh  # Unix/Linux/Mac
database\migrate.bat   # Windows
```

### 2. Verify Migration

```sql
-- Check table exists
SELECT * FROM information_schema.tables WHERE table_name = 'notifications';

-- Check structure
\d notifications

-- Test insert
INSERT INTO notifications (user_id, type, title, message)
VALUES (
  (SELECT id FROM users LIMIT 1),
  'system_alert',
  'Test',
  'Migration successful'
);
```

### 3. Restart Application

The notification cleanup service will initialize automatically on startup.

## ✨ New Features

### API Endpoints

- `GET /api/v1/notifications` - Get paginated notifications
- `GET /api/v1/notifications/unread-count` - Get unread count
- `PUT /api/v1/notifications/:id/read` - Mark as read
- `PUT /api/v1/notifications/read-all` - Mark all as read
- `DELETE /api/v1/notifications/:id` - Delete notification

### Background Jobs

- **Notification Cleanup**: Runs daily at 2:00 AM, deletes notifications older than 90 days

### WebSocket Events

- `notification:new` - Emitted when a notification is created

## 📊 Database Changes

### New Table: `notifications`

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
);
```

### New ENUM: `notification_type`

12 notification types including:
- session_booked, session_confirmed, session_cancelled
- payment_received, payment_failed
- review_received, escrow_released
- dispute_opened, meeting_confirmed
- And more...

### Indexes Added

6 indexes for optimal query performance on user_id, type, is_read, and created_at.

## 🔍 Testing After Deployment

### 1. Test API Endpoints

```bash
# Get notifications
curl -H "Authorization: Bearer $TOKEN" \
     https://your-api.com/api/v1/notifications

# Get unread count
curl -H "Authorization: Bearer $TOKEN" \
     https://your-api.com/api/v1/notifications/unread-count
```

### 2. Test WebSocket

```javascript
const socket = io('https://your-api.com', {
  auth: { token: 'YOUR_JWT_TOKEN' }
});

socket.on('notification:new', (data) => {
  console.log('✅ WebSocket working:', data);
});
```

### 3. Create Test Notification

```typescript
// In your application code
await NotificationService.create('user-id', 'system_alert', {
  title: 'Deployment Test',
  message: 'Notification system is live!',
  data: { test: true }
});
```

## 📈 Monitoring

### Logs to Watch

- `Notification cleanup service initialized` - Service started successfully
- `Notification cleanup completed: X notifications deleted` - Daily cleanup running
- `Failed to emit notification:new event` - WebSocket issues (non-critical)

### Metrics to Track

- Notification creation rate
- Unread notification count per user
- WebSocket connection success rate
- Cleanup job execution time

## 🔄 Rollback Plan

If issues occur:

### 1. Rollback Code

```bash
git revert HEAD
git push origin main
```

### 2. Drop Table (if needed)

```sql
DROP TABLE IF EXISTS notifications CASCADE;
DROP TYPE IF EXISTS notification_type CASCADE;
```

## 📚 Documentation

- **API Docs**: `docs/notifications-api.md`
- **Integration Examples**: `docs/notification-integration-examples.md`
- **Quick Reference**: `NOTIFICATIONS_QUICK_REFERENCE.md`
- **Implementation Summary**: `NOTIFICATIONS_IMPLEMENTATION_SUMMARY.md`
- **Migration Instructions**: `MIGRATION_INSTRUCTIONS.md`

## ⚙️ Configuration

No new environment variables required. The system uses existing:
- Database connection (DATABASE_URL)
- JWT authentication (JWT_SECRET)
- WebSocket configuration (existing)

## 🎯 Success Criteria

- ✅ Migration runs without errors
- ✅ Application starts successfully
- ✅ API endpoints return 200 responses
- ✅ WebSocket events are received
- ✅ Cleanup service initializes
- ✅ No errors in application logs

## 🆘 Support

If issues arise:
1. Check application logs for errors
2. Verify database migration completed
3. Test WebSocket connectivity
4. Review `MIGRATION_INSTRUCTIONS.md` for troubleshooting

## 📝 Changelog

### Added
- Centralized notification system
- 5 new API endpoints
- WebSocket real-time delivery
- Auto-cleanup cron job
- Comprehensive documentation

### Modified
- `src/routes/index.ts` - Added notifications routes
- `src/services/notification.service.ts` - Added WebSocket integration

### Database
- New table: `notifications`
- New ENUM: `notification_type`
- 6 new indexes

---

**Deployment Date**: _To be filled_  
**Deployed By**: _To be filled_  
**Environment**: _To be filled_  
**Status**: _To be filled_
