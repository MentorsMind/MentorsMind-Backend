# Database Tables Overview

Quick reference guide for all database tables in the MentorsMind platform.

## Core Tables

### 👤 users
**Purpose:** Store all user accounts (mentees, mentors, admins)

**Key Fields:**
- `id` (UUID) - Primary key
- `email` (VARCHAR) - Unique email address
- `role` (ENUM) - mentee, mentor, admin
- `stellar_public_key` (VARCHAR) - Stellar wallet address
- `hourly_rate` (DECIMAL) - Mentor's rate
- `average_rating` (DECIMAL) - Computed rating
- `total_sessions_completed` (INTEGER) - Session count

**Relationships:**
- Has many: wallets, bookings, reviews, transactions

---

### 💰 wallets
**Purpose:** Stellar blockchain wallets for users

**Key Fields:**
- `id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key to users
- `stellar_public_key` (VARCHAR) - Stellar address
- `native_balance` (DECIMAL) - XLM balance
- `status` (ENUM) - active, frozen, closed

**Relationships:**
- Belongs to: user
- Has many: wallet_balances, wallet_transactions

---

### 💵 wallet_balances
**Purpose:** Track multiple asset balances per wallet

**Key Fields:**
- `id` (UUID) - Primary key
- `wallet_id` (UUID) - Foreign key to wallets
- `asset_type` (VARCHAR) - native, credit_alphanum4, etc.
- `asset_code` (VARCHAR) - Asset code (USD, EUR, etc.)
- `balance` (DECIMAL) - Current balance

**Relationships:**
- Belongs to: wallet

---

### 🔄 transactions
**Purpose:** All financial transactions with Stellar integration

**Key Fields:**
- `id` (UUID) - Primary key
- `user_id` (UUID) - Foreign key to users
- `type` (ENUM) - deposit, withdrawal, payment, refund, etc.
- `status` (ENUM) - pending, processing, completed, failed
- `amount` (DECIMAL) - Transaction amount
- `stellar_tx_hash` (VARCHAR) - Blockchain transaction hash
- `stellar_ledger_sequence` (INTEGER) - Ledger number
- `platform_fee` (DECIMAL) - Platform fee
- `network_fee` (DECIMAL) - Stellar network fee

**Relationships:**
- Belongs to: user, wallet, booking
- Has many: transaction_events

---

### 📅 bookings
**Purpose:** Mentorship session bookings

**Key Fields:**
- `id` (UUID) - Primary key
- `mentee_id` (UUID) - Foreign key to users
- `mentor_id` (UUID) - Foreign key to users
- `scheduled_start` (TIMESTAMP) - Session start time
- `scheduled_end` (TIMESTAMP) - Session end time
- `status` (ENUM) - pending, confirmed, completed, cancelled
- `payment_status` (ENUM) - unpaid, paid, held_in_escrow, released
- `amount` (DECIMAL) - Session price
- `platform_fee` (DECIMAL) - Platform fee
- `mentor_payout` (DECIMAL) - Mentor earnings

**Relationships:**
- Belongs to: mentee (user), mentor (user)
- Has many: booking_notes, booking_participants, reviews
- Has one: payment_transaction, payout_transaction

---

### ⭐ reviews
**Purpose:** User reviews and ratings

**Key Fields:**
- `id` (UUID) - Primary key
- `booking_id` (UUID) - Foreign key to bookings
- `reviewer_id` (UUID) - Foreign key to users
- `reviewee_id` (UUID) - Foreign key to users
- `rating` (INTEGER) - 1-5 stars
- `comment` (TEXT) - Review text
- `helpful_count` (INTEGER) - Helpful votes
- `is_published` (BOOLEAN) - Published status

**Relationships:**
- Belongs to: booking, reviewer (user), reviewee (user)
- Has many: review_votes, review_reports

---

## Supporting Tables

### 📝 booking_notes
**Purpose:** Session notes by mentors or mentees

**Key Fields:**
- `booking_id` (UUID) - Foreign key to bookings
- `author_id` (UUID) - Foreign key to users
- `content` (TEXT) - Note content
- `is_private` (BOOLEAN) - Private to author

---

### 👥 booking_participants
**Purpose:** Track participants in group sessions

**Key Fields:**
- `booking_id` (UUID) - Foreign key to bookings
- `user_id` (UUID) - Foreign key to users
- `role` (VARCHAR) - mentor, mentee, observer
- `attendance_status` (VARCHAR) - attended, absent

---

### 📊 transaction_events
**Purpose:** Audit trail for transaction status changes

**Key Fields:**
- `transaction_id` (UUID) - Foreign key to transactions
- `event_type` (VARCHAR) - status_change, retry, error
- `old_status` (ENUM) - Previous status
- `new_status` (ENUM) - New status

---

### 💳 wallet_transactions
**Purpose:** Blockchain transaction history

**Key Fields:**
- `wallet_id` (UUID) - Foreign key to wallets
- `stellar_tx_hash` (VARCHAR) - Transaction hash
- `stellar_ledger` (INTEGER) - Ledger number
- `operation_type` (VARCHAR) - payment, create_account, etc.
- `successful` (BOOLEAN) - Transaction success

---

### 👍 review_votes
**Purpose:** Helpful/not helpful votes on reviews

**Key Fields:**
- `review_id` (UUID) - Foreign key to reviews
- `user_id` (UUID) - Foreign key to users
- `is_helpful` (BOOLEAN) - Vote type

---

### 🚩 review_reports
**Purpose:** Reports of inappropriate reviews

**Key Fields:**
- `review_id` (UUID) - Foreign key to reviews
- `reporter_id` (UUID) - Foreign key to users
- `reason` (VARCHAR) - Report reason
- `status` (VARCHAR) - pending, reviewed, resolved

---

### 📋 audit_logs
**Purpose:** System-wide audit trail

**Key Fields:**
- `level` (VARCHAR) - info, warn, error
- `action` (VARCHAR) - Action performed
- `user_id` (UUID) - User who performed action
- `entity_type` (VARCHAR) - Type of entity
- `entity_id` (VARCHAR) - Entity ID
- `metadata` (JSONB) - Additional data

---

### ⚖️ disputes
**Purpose:** Transaction dispute management

**Key Fields:**
- `transaction_id` (UUID) - Foreign key to transactions
- `reporter_id` (UUID) - Foreign key to users
- `reason` (TEXT) - Dispute reason
- `status` (VARCHAR) - open, resolved, dismissed

---

### ⚙️ system_configs
**Purpose:** Platform configuration settings

**Key Fields:**
- `key` (VARCHAR) - Config key (primary key)
- `value` (JSONB) - Config value
- `updated_at` (TIMESTAMP) - Last update

---

## Table Sizes (Estimated)

| Table | Estimated Rows | Growth Rate |
|-------|---------------|-------------|
| users | 10,000+ | Medium |
| wallets | 10,000+ | Medium |
| wallet_balances | 30,000+ | Medium |
| transactions | 100,000+ | High |
| bookings | 50,000+ | High |
| reviews | 40,000+ | Medium |
| audit_logs | 500,000+ | Very High |
| transaction_events | 200,000+ | High |
| wallet_transactions | 150,000+ | High |

## Indexes Summary

### Primary Indexes (17)
One per table on `id` field

### Foreign Key Indexes (25+)
All foreign key columns indexed

### Performance Indexes (20+)
- Status fields
- Date/timestamp fields
- Email, username
- Stellar keys and hashes

### Composite Indexes (10+)
- (role, status, rating) on users
- (user_id, created_at, status) on transactions
- (mentor_id, status, scheduled_start) on bookings

### Special Indexes (8+)
- Full-text search on users
- Full-text search on bookings
- GIN indexes on JSONB fields
- GIN indexes on array fields

## Triggers Summary

### Auto-Timestamp (9 triggers)
Automatically update `updated_at` on:
- users, wallets, wallet_balances
- transactions, bookings
- reviews, review_reports, booking_notes
- disputes

### Business Logic (6 triggers)
- Update user rating stats on review changes
- Update review helpful counts on votes
- Update session completion counts
- Log transaction status changes
- Validate booking times and prevent overlaps
- Set timestamps based on status changes

## Views Summary

### v_active_mentors
Active mentors sorted by rating

### v_user_transaction_summary
Transaction statistics per user

### v_mentor_booking_stats
Booking statistics per mentor

### v_upcoming_bookings
All upcoming bookings with details

## Functions Summary

### get_user_wallet_balance(user_id, asset_code)
Get wallet balances for a user

### get_platform_statistics()
Get overall platform statistics

## Data Types Used

### Standard Types
- UUID (primary keys)
- VARCHAR (strings)
- TEXT (long text)
- INTEGER (counts)
- DECIMAL (money, ratings)
- BOOLEAN (flags)
- TIMESTAMP WITH TIME ZONE (dates)

### PostgreSQL Specific
- ENUM (type safety)
- JSONB (flexible data)
- ARRAY (lists)
- GENERATED ALWAYS AS (computed columns)

## Constraints Summary

### Primary Keys: 17
One per table

### Foreign Keys: 25+
All relationships enforced

### Unique Constraints: 15+
- Email, username
- Stellar public keys
- Transaction hashes
- Composite uniques

### Check Constraints: 20+
- Email format
- Stellar key format
- Rating ranges (1-5)
- Positive amounts
- Date validations

## Quick Reference

### Find a User
```sql
SELECT * FROM users WHERE email = 'user@example.com';
```

### Get User's Wallet Balance
```sql
SELECT * FROM get_user_wallet_balance('user-uuid', NULL);
```

### List Active Mentors
```sql
SELECT * FROM v_active_mentors LIMIT 10;
```

### Get Upcoming Bookings
```sql
SELECT * FROM v_upcoming_bookings WHERE mentor_id = 'uuid';
```

### Check Transaction Status
```sql
SELECT * FROM transactions WHERE stellar_tx_hash = 'hash';
```

### Platform Statistics
```sql
SELECT * FROM get_platform_statistics();
```
