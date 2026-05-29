# Database Table Validation - Quick Reference

## Overview

The application now validates that all required database tables exist at startup instead of creating them at runtime. This ensures proper separation between migrations (DDL) and application code (DML).

## How It Works

### Startup Flow
1. Application starts
2. Models are initialized
3. **Table validation runs** - checks all required tables exist
4. Results are logged
5. Health check includes table status

### Validation Utility

**Location**: `src/utils/table-validator.utils.ts`

**Key Functions**:
```typescript
// Validate all required tables
const result = await validateRequiredTables();

// Check if a specific table exists
const exists = await tableExists('users');
```

**Return Format**:
```typescript
{
  allTablesExist: boolean,
  totalTables: number,
  missingTables: string[],
  results: Array<{ tableName: string, exists: boolean }>
}
```

## Adding a New Table

When you create a new table, follow these steps:

### 1. Create Migration File
```bash
# In database/migrations/
# Create: 047_create_new_table.sql
```

```sql
CREATE TABLE IF NOT EXISTS new_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- your columns
);
```

### 2. Add to Required Tables List
Edit `src/utils/table-validator.utils.ts`:

```typescript
const REQUIRED_TABLES = [
  // ... existing tables
  'new_table',  // Add here
];
```

### 3. Run Migration
```bash
npm run migrate
```

### 4. Verify
```bash
npm start
# Check logs for: "Database validation successful: all required tables exist"
```

## Health Check Integration

The health endpoint now includes table validation:

```bash
curl http://localhost:3000/health/ready
```

**Response**:
```json
{
  "status": "healthy",
  "components": {
    "db": { "status": "healthy" },
    "tables": { 
      "status": "healthy",
      "details": { "totalTables": 25 }
    }
  }
}
```

## Troubleshooting

### Missing Tables at Startup

**Log Output**:
```
ERROR: Database validation failed: 2 table(s) missing. 
       Please run migrations before starting the server.
Missing tables: ["system_configs", "disputes"]
```

**Solution**:
```bash
# Run migrations
npm run migrate

# Or manually apply specific migration
npx pg-migrate up
```

### Health Check Reports Unhealthy Tables

**Check which tables are missing**:
```bash
curl http://localhost:3000/health/ready | jq '.components.tables'
```

**Verify in database**:
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('system_configs', 'disputes');
```

### Migration Already Applied but Table Missing

This shouldn't happen, but if it does:

1. Check migration status:
```bash
npx pg-migrate status
```

2. Force re-run migration (careful!):
```bash
npx pg-migrate up --force
```

3. Verify table exists:
```sql
\dt public.*
```

## Best Practices

✅ **DO**:
- Create all tables in migration files
- Add new tables to REQUIRED_TABLES list
- Run migrations before deploying
- Monitor health endpoint for table status
- Use `tableExists()` for optional feature checks

❌ **DON'T**:
- Use `CREATE TABLE` in application code
- Call `initializeTable()` methods
- Skip migration step in deployment
- Ignore missing table errors in logs
- Give application user DDL permissions in production

## Required Tables (Current List)

Core:
- users
- wallets
- transactions
- transaction_events

Bookings:
- bookings
- sessions

Admin:
- disputes
- dispute_evidence
- system_configs
- audit_logs

Communication:
- notifications
- conversations
- messages

Other:
- mentor_verifications
- goals
- refresh_tokens
- reviews
- push_tokens
- oauth_accounts
- user_sessions
- webhooks
- webhook_deliveries
- api_keys
- consent_records

**Total**: 25 tables (as of this writing)

## Related Documentation

- Full implementation details: `ADMIN_SERVICE_DDL_FIX.md`
- Migration guide: `database/README.md`
- Database schema: `database/schema.sql`
