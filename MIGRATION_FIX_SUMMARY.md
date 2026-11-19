# Migration Fix: PostgreSQL ENUM Usage Error

## 🚨 Problem Fixed

**Error**: `unsafe use of new value "banned" of enum type user_status. New enum values must be committed before they can be used.`

**Location**: `database/migrations/057_add_suspension_ban_fields.sql`

## 🔧 Root Cause

PostgreSQL has a strict rule: **new ENUM values cannot be used in the same transaction where they are created**. 

In the failing migration:
1. Line 8: `ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'banned';` - Creates new ENUM value
2. Line 21: `CREATE INDEX ... WHERE status = 'banned'` - **FAILS** trying to use the new value immediately

## ✅ Solution Applied

### 1. Fixed Migration 057
**File**: `database/migrations/057_add_suspension_ban_fields.sql`

**Changes**:
- ✅ Kept the ENUM value addition
- ✅ Kept all column additions  
- ✅ Kept the `suspended` status index (uses existing ENUM value)
- ❌ **Removed** the `banned` status index (moved to separate migration)

### 2. Created New Migration 110
**File**: `database/migrations/110_add_banned_status_index.sql`

**Purpose**: 
- Creates the `idx_users_status_banned` index safely
- Runs after the ENUM value is committed from migration 057
- Clean separation of concerns

## 📁 Files Modified

### `database/migrations/057_add_suspension_ban_fields.sql`
```sql
-- ✅ SAFE: Add ENUM value
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'banned';

-- ✅ SAFE: Add columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
-- ... other columns ...

-- ✅ SAFE: Index using existing ENUM value
CREATE INDEX IF NOT EXISTS idx_users_status_suspended ON users(status) WHERE status = 'suspended';

-- ❌ REMOVED: Unsafe index using new ENUM value
-- CREATE INDEX IF NOT EXISTS idx_users_status_banned ON users(status) WHERE status = 'banned';
```

### `database/migrations/110_add_banned_status_index.sql` (NEW)
```sql
-- ✅ SAFE: Now we can use the committed ENUM value
CREATE INDEX IF NOT EXISTS idx_users_status_banned ON users(status) WHERE status = 'banned';
```

## 🧪 Testing

Created `database/test-migration-fix.sql` to verify:
1. ENUM value addition works
2. Same-transaction usage demonstrates the limitation  
3. Current ENUM values can be queried
4. Indexes are created correctly

## 🚀 Migration Order

The migrations will now run in this safe sequence:

1. **Migration 057** runs first:
   - ✅ Adds 'banned' to user_status ENUM
   - ✅ Adds all suspension/ban columns
   - ✅ Creates suspended status index
   - ✅ **COMMITS** the transaction

2. **Migration 110** runs later:
   - ✅ Creates banned status index (now safe to use committed ENUM value)

## 🔍 Verification Commands

After running migrations, verify the fix:

```sql
-- Check ENUM values
SELECT unnest(enum_range(NULL::user_status)) as status_values;

-- Check indexes exist
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'users' AND indexname LIKE '%status%';

-- Verify both indexes work
EXPLAIN (COSTS OFF) SELECT * FROM users WHERE status = 'suspended';
EXPLAIN (COSTS OFF) SELECT * FROM users WHERE status = 'banned';
```

## 🎯 Expected Results

- ✅ **Migration 057** completes successfully
- ✅ **Migration 110** completes successfully  
- ✅ Both `suspended` and `banned` status indexes exist
- ✅ No PostgreSQL ENUM constraint violations
- ✅ Fast queries for both user statuses

## 📚 PostgreSQL ENUM Rules

**Remember for future migrations:**

1. ✅ **DO**: Add ENUM values in separate transactions from their usage
2. ❌ **DON'T**: Use new ENUM values in the same migration where they're created
3. ✅ **DO**: Split into multiple migrations if needed
4. ✅ **DO**: Use `IF NOT EXISTS` for safety

This fix ensures database migrations are robust and follow PostgreSQL best practices! 🎉