# DDL-at-Runtime Anti-Pattern Removal

## Summary

Successfully removed the DDL-at-runtime anti-pattern from the MentorsMind backend codebase. Database table creation is now managed **exclusively** by migration files in `database/migrations/`, not at application startup.

## Changes Made

### 1. **models/index.ts** - Converted to Barrel Export
- **Before**: Called `initializeTable()` on 8 different models at startup
- **After**: Simple barrel export file with no runtime initialization
- **Impact**: Removes runtime DDL for audit_logs, export_jobs, sessions, transactions, reviews, notifications, and related tables

### 2. **server.ts** - Removed initializeModels() Call
- **Before**: Called `initializeModels()` which triggered DDL operations
- **After**: Only calls `validateRequiredTables()` to verify migrations were applied
- **Impact**: Startup now validates rather than creates tables

### 3. **bookings.service.ts** - Removed initializeTable() Call
- **Before**: `BookingsService.initialize()` called `BookingModel.initializeTable()`
- **After**: Only starts background escrow monitoring (no DDL)
- **Impact**: Bookings table created by migration 004_create_bookings.sql

### 4. **recommendation.service.ts** - Removed initialize() Method
- **Before**: Created `recommendation_events` and `dismissed_recommendations` tables at runtime
- **After**: Method removed entirely; tables created by migration 034_create_recommendation_events.sql
- **Impact**: No runtime DDL for recommendation tables

### 5. **routes/v1/index.ts** - Cleaned Up Service Initialization
- **Removed**: `VerificationService.initialize()` call (already had no-op implementation)
- **Removed**: `RecommendationService.initialize()` call
- **Kept**: `BookingsService.initialize()` (now only starts background jobs)
- **Kept**: `notificationCleanupService.initialize()` (only starts cron job, no DDL)

### 6. **table-validator.utils.ts** - Enhanced Table Validation
- **Added**: 20+ additional tables to the required tables list
- **Includes**: export_jobs, recommendation_events, dismissed_recommendations, notification_templates, etc.
- **Impact**: Comprehensive validation ensures all migrations were applied before serving requests

### 7. **database/migrations/047_create_export_jobs.sql** - New Migration
- **Created**: Migration file for export_jobs table (was previously created at runtime)
- **Impact**: Ensures export_jobs table is created via proper migration process

### 8. **bookings.service.test.ts** - Updated Tests
- **Before**: Tests verified that `initializeTable()` was called
- **After**: Tests verify that `initializeTable()` is NOT called (schema managed by migrations)

## Migration Files Reference

All tables are now created by these migration files:

| Table | Migration File |
|-------|---------------|
| users | 001_create_users.sql |
| wallets | 002_create_wallets.sql |
| transactions | 003_create_transactions.sql |
| bookings | 004_create_bookings.sql |
| reviews | 005_create_reviews.sql |
| disputes | 010_create_disputes.sql |
| disputes_evidence | 010_create_disputes.sql |
| notifications | 014_create_notifications.sql |
| audit_logs | 016_create_audit_logs.sql, 027_create_audit_logs.sql |
| mentor_verifications | 017_create_mentor_verifications.sql |
| conversations | 018_create_conversations.sql |
| messages | 019_create_messages.sql |
| system_configs | 046_create_system_configs.sql |
| export_jobs | 047_create_export_jobs.sql (NEW) |
| recommendation_events | 034_create_recommendation_events.sql |
| dismissed_recommendations | 034_create_recommendation_events.sql |
| sessions | 003_add_timezone_support.sql |
| And more... | See database/migrations/ |

## Startup Flow (New)

1. **Bootstrap** → Load secrets
2. **Server** → Validate environment variables
3. **Validate Tables** → Check all required tables exist (from migrations)
4. **Initialize Email Templates** → Seed notification templates
5. **Initialize JWKS** → Generate RSA key pair if needed
6. **Start Services** → Background jobs, schedulers, WebSocket, etc.
7. **Listen** → Start HTTP server

## Benefits

✅ **No Runtime DDL**: Tables are never created at application startup  
✅ **Migration-First**: All schema changes go through proper migration process  
✅ **Validation at Startup**: Missing tables are detected and logged immediately  
✅ **Production-Safe**: No race conditions or permission issues from DDL at runtime  
✅ **Audit Trail**: All schema changes tracked in migration files  
✅ **Team Collaboration**: Clear ownership of schema changes via migrations  

## Remaining Work (Optional)

The following models still have `initializeTable()` methods defined but they are no longer called:

- `AuditLogModel.initializeTable()`
- `ExportJobModel.initializeTable()`
- `SessionModel.initializeTable()`
- `PaymentModel.initializeTable()`
- `ReviewModel.initializeTable()`
- `NotificationsModel.initializeTable()`
- `NotificationTemplatesModel.initializeTable()`
- `NotificationDeliveryTrackingModel.initializeTable()`
- `NotificationAnalyticsModel.initializeTable()`
- `BookingModel.initializeTable()`
- `EscrowModel.initializeTable()`
- `WalletModel.initializeTable()`
- `PayoutRequestModel.initializeTable()`
- `WalletEventModel.initializeTable()`

These methods can be safely removed from the model files in a future cleanup, or kept as documentation of the table schema. They are currently **not being called** anywhere in the codebase.

## Testing

To verify the changes work correctly:

1. Run all migrations: `npm run migrate`
2. Start the server: `npm run dev`
3. Check logs for: "Database validation successful: all required tables exist"
4. If tables are missing, you'll see: "Database validation failed: X table(s) missing"

## Related Issues

- Fixes: AdminService.initialize() DDL anti-pattern
- Fixes: BookingsService.initialize() DDL anti-pattern  
- Fixes: RecommendationService.initialize() DDL anti-pattern
- Improves: Overall database schema management practices
