# MentorsMind Database Schema

Complete PostgreSQL database schema for the MentorsMind platform with Stellar blockchain integration.

## Overview

This database schema supports a mentorship platform with the following key features:

- User management (mentees, mentors, admins)
- Stellar blockchain wallet integration
- Multi-asset wallet support
- Booking/session management
- Payment processing with escrow
- Review and rating system
- Audit logging
- Dispute resolution

## Schema Structure

### Core Tables

1. **users** - User accounts with role-based access
2. **wallets** - Stellar blockchain wallets
3. **wallet_balances** - Multi-asset balance tracking
4. **transactions** - Financial transactions with Stellar integration
5. **bookings** - Mentorship session bookings
6. **reviews** - User reviews and ratings
7. **audit_logs** - System audit trail
8. **disputes** - Transaction dispute management
9. **system_configs** - Platform configuration

### Supporting Tables

- **wallet_transactions** - Blockchain transaction history
- **transaction_events** - Transaction status change audit trail
- **booking_participants** - Session participants (for group sessions)
- **booking_notes** - Session notes
- **review_votes** - Review helpfulness votes
- **review_reports** - Flagged review reports

## Quick Start

### Prerequisites

- PostgreSQL 14+
- psql command-line tool
- Environment variables configured in `.env`

### Running Migrations

```bash
# Make scripts executable
chmod +x database/migrate.sh database/rollback.sh

# Run all migrations
cd database
./migrate.sh
```

### Loading Seed Data

```bash
# Load sample data for development
psql -h localhost -U postgres -d mentorminds -f seed.sql
```

### Rolling Back (⚠️ Destructive)

```bash
# WARNING: This drops all tables and data
./rollback.sh
```

## Migration Files

Migrations are executed in order:

1. `001_create_users.sql` - Users table with Stellar keys
2. `002_create_wallets.sql` - Wallets with multi-asset support
3. `003_create_transactions.sql` - Transactions with blockchain integration
4. `004_create_bookings.sql` - Booking/session management
5. `005_create_reviews.sql` - Review and rating system
6. `006_create_indexes.sql` - Performance indexes
7. `007_create_triggers.sql` - Auto-timestamp and business logic triggers

## Key Features

### Stellar Integration

- **Public Key Storage**: Users and wallets store Stellar public keys (G...)
- **Transaction Hashing**: All transactions reference Stellar tx hashes
- **Ledger Tracking**: Transactions track Stellar ledger sequences
- **Multi-Asset Support**: Wallets support native XLM and custom assets
- **Trust Lines**: Wallet balances track trusted assets

### Security Features

- UUID primary keys for all tables
- Soft delete support (deleted_at)
- Password hashing (bcrypt)
- Email verification tracking
- KYC verification support
- Account locking mechanism
- Audit logging for all critical actions

### Performance Optimizations

- Comprehensive indexing strategy
- Partial indexes for common queries
- Full-text search indexes
- JSONB indexes for metadata
- Composite indexes for complex queries
- Generated columns for computed values

### Data Integrity

- Foreign key constraints
- Check constraints for data validation
- Unique constraints
- NOT NULL constraints where appropriate
- Trigger-based validation
- Automatic timestamp updates

## Database Views

### v_active_mentors
Active mentors with statistics, sorted by rating.

```sql
SELECT * FROM v_active_mentors LIMIT 10;
```

### v_user_transaction_summary
Transaction summary by user.

```sql
SELECT * FROM v_user_transaction_summary WHERE user_id = 'uuid';
```

### v_mentor_booking_stats
Booking statistics by mentor.

```sql
SELECT * FROM v_mentor_booking_stats WHERE mentor_id = 'uuid';
```

### v_upcoming_bookings
All upcoming confirmed bookings with participant details.

```sql
SELECT * FROM v_upcoming_bookings;
```

## Database Functions

### get_user_wallet_balance(user_id, asset_code)
Get wallet balances for a user.

```sql
SELECT * FROM get_user_wallet_balance('user-uuid', 'XLM');
```

### get_platform_statistics()
Get overall platform statistics.

```sql
SELECT * FROM get_platform_statistics();
```

## Triggers

### Auto-Timestamp Triggers
Automatically update `updated_at` on all tables when records are modified.

### Business Logic Triggers

- **update_user_rating_stats**: Recalculates user ratings when reviews change
- **update_review_helpful_counts**: Updates review vote counts
- **update_user_session_count**: Increments session completion counts
- **log_transaction_status_change**: Creates audit trail for transaction changes
- **validate_booking_times**: Prevents overlapping bookings
- **set_transaction_timestamps**: Auto-sets timestamps based on status
- **set_booking_completion_timestamp**: Auto-sets completion timestamps

## Data Types

### ENUMs

- **user_role**: mentee, mentor, admin
- **user_status**: active, inactive, suspended, pending_verification
- **wallet_status**: active, frozen, closed
- **transaction_type**: deposit, withdrawal, payment, refund, platform_fee, mentor_payout, escrow_hold, escrow_release
- **transaction_status**: pending, processing, completed, failed, cancelled, refunded
- **booking_status**: pending, confirmed, in_progress, completed, cancelled, no_show
- **payment_status**: unpaid, paid, held_in_escrow, released, refunded, disputed

## Indexes Strategy

### Primary Indexes
- All foreign keys are indexed
- Status fields are indexed
- Timestamp fields for sorting

### Composite Indexes
- User search (role + availability + rating)
- Transaction history (user + date + status)
- Booking queries (mentor/mentee + status + date)

### Partial Indexes
- Active records only (WHERE deleted_at IS NULL)
- Published reviews only
- Pending transactions only

### Full-Text Search
- User profiles (name + bio + username)
- Booking descriptions

### JSONB Indexes
- Metadata fields (GIN indexes)
- Trusted assets arrays

## Best Practices

### Querying

```sql
-- Always filter soft-deleted records
SELECT * FROM users WHERE deleted_at IS NULL;

-- Use prepared statements to prevent SQL injection
-- Use parameterized queries in application code

-- Leverage indexes for performance
SELECT * FROM users 
WHERE role = 'mentor' 
  AND status = 'active' 
  AND is_available = TRUE
ORDER BY average_rating DESC;
```

### Transactions

```sql
-- Use transactions for multi-step operations
BEGIN;
  UPDATE bookings SET status = 'completed' WHERE id = 'uuid';
  UPDATE transactions SET status = 'completed' WHERE booking_id = 'uuid';
COMMIT;
```

### Pagination

```sql
-- Use LIMIT and OFFSET for pagination
SELECT * FROM bookings 
ORDER BY created_at DESC 
LIMIT 20 OFFSET 0;
```

## Maintenance

### Vacuum and Analyze

```bash
# Regular maintenance
psql -d mentorminds -c "VACUUM ANALYZE;"
```

### Backup

```bash
# Backup database
pg_dump -h localhost -U postgres mentorminds > backup_$(date +%Y%m%d).sql

# Restore database
psql -h localhost -U postgres mentorminds < backup_20240101.sql
```

### Monitor Performance

```sql
-- Check table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

## TypeScript Integration

TypeScript types are auto-generated in `src/types/database.types.ts`:

```typescript
import { User, Booking, Transaction } from './types/database.types';

// Type-safe database operations
const user: User = await getUserById(id);
const bookings: Booking[] = await getUpcomingBookings();
```

## Entity Relationship Diagram

```
┌─────────────┐
│    users    │
└──────┬──────┘
       │
       ├──────────┬──────────┬──────────┐
       │          │          │          │
┌──────▼──────┐ ┌▼────────┐ ┌▼────────┐ ┌▼────────┐
│   wallets   │ │bookings │ │reviews  │ │disputes │
└──────┬──────┘ └──┬──────┘ └─────────┘ └─────────┘
       │           │
┌──────▼──────┐   │
│wallet_      │   │
│balances     │   │
└─────────────┘   │
                  │
           ┌──────▼──────┐
           │transactions │
           └─────────────┘
```

## Support

For issues or questions:
- Check existing documentation
- Review migration files
- Examine trigger and function definitions
- Test with seed data

## License

MIT License - see LICENSE file for details
