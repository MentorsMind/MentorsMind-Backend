# Database Fixtures & Seeds

This directory contains fixture generators that populate the database with deterministic, repeatable test data. All fixtures run within a single PostgreSQL transaction for atomicity and easy rollback.

## Fixtures Overview

### **users.seed.ts**
Creates a set of admin, mentor, and mentee users with deterministic data.

- **Admin user**: Single admin account for platform management (`admin@mentorsmind.com`)
- **Mentors**: Accounts with expertise arrays, hourly rates, bios, years of experience, ratings
- **Mentees**: Basic learner accounts with timezone info
- **Common**: All users receive pre-hashed bcrypt passwords (`Password123!`) and deterministic Stellar public keys

**Size options**:
- `test`: 2 mentors, 3 mentees
- `dev`: 5 mentors, 10 mentees

### **mentors.seed.ts**
Creates wallet profiles and account balances for all users created by `users.seed.ts`.

- **Wallets**: Linked to each user's Stellar public key
- **XLM Balances**:
  - Mentors: 100–1000 XLM (randomized per seed)
  - Mentees: 10–200 XLM
- **Wallet Balance Entries**: Native asset balance tracking in `wallet_balances` table

### **sessions.seed.ts**
Creates bookings (sessions) and payment transactions linking mentors and mentees.

- **Bookings**: Title, session type (`video_call`, `audio_call`, `chat`), duration (30–90 min)
- **Mix of past & future**:
  - ~50% past sessions marked as `completed` (used for review seeds)
  - ~50% future sessions marked as `confirmed`
- **Payment Transactions**: Stellar transaction hashes, escrow status, platform fees (5%)
- **Calculated amounts**: Hourly rate → session duration → total amount, mentor payout, platform fee

**Sessions per mentor**: Configured by size (2 in test, 5 in dev)

### **reviews.seed.ts**
Creates reviews only for completed bookings from `sessions.seed.ts`.

- **Reviews**: Rating (3–5 stars), title, comment, sub-ratings (communication, professionalism, knowledge, punctuality)
- **Deterministic**: Randomly selected from predefined title and comment pools using seeded RNG
- **One review per completed booking**: Prevents duplicate review entries

## How to Use Fixtures

### Running Seeds

```bash
# Seed with default size (dev)
npm run seed

# Seed with test size (smaller datasets for faster tests)
npm run seed --size=test

# Reset database and seed (truncates all tables, then seeds)
npm run seed:reset --size=test

# Production/staging (runs in transactional mode, no truncate)
NODE_ENV=production npm run seed --size=dev
```

### Using Seeds in Integration Tests

Seeds create actual database records. Typically, integration tests:

1. Run seeds once to populate the database
2. Execute test queries against real data
3. Clean up via transaction rollback (see **Test Isolation** below)

**Example integration test**:
```typescript
import { seedUsers, seedMentorProfiles } from '../database/seeds';
import { seedSessions } from '../database/seeds/sessions.seed';
import pool from '../src/config/database';

describe('Mentor Service Integration Tests', () => {
  beforeAll(async () => {
    // Seed all fixtures into a real PostgreSQL database
    await runSeeds([seedUsers, seedMentorProfiles, seedSessions], 'test');
  });

  it('should fetch mentor with completed sessions', async () => {
    // Query against seeded data
    const result = await pool.query(
      `SELECT id, total_sessions_completed FROM users WHERE role = 'mentor' LIMIT 1`
    );
    expect(result.rows[0].total_sessions_completed).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await resetDatabase(); // Truncate all tables
  });
});
```

## Adding New Fixtures

1. **Create a new seed file** in `database/seeds/`:
   ```typescript
   import { PoolClient } from 'pg';
   import { SeedFn, SeedSize } from '../../src/utils/seed-runner.utils';

   export const seedYourFeature: SeedFn = async (client: PoolClient, size: SeedSize) => {
     console.log('  → Seeding your feature...');
     
     // Use client.query() for all database operations
     // Example: INSERT, UPDATE, SELECT within the transaction
     
     let count = 0;
     // Your seeding logic here
     
     console.log(`  ✓ Seeded ${count} records`);
   };
   ```

2. **Export your seed function** from `database/seeds/index.ts`:
   ```typescript
   import { seedYourFeature } from './your-feature.seed';
   
   const SEEDS = [seedUsers, seedMentorProfiles, seedSessions, seedReviews, seedYourFeature];
   ```

3. **Use deterministic RNG** for reproducible data:
   ```typescript
   import { seededRandom, pick, pickN } from '../../src/utils/seed-runner.utils';
   
   const rng = seededRandom(`your-feature-${id}`);
   const randomValue = rng(); // Returns 0–1
   const pickedItem = pick(['option1', 'option2'], rng);
   ```

4. **Avoid external dependencies**: Seeds should use only PostgreSQL and the seeding utilities. No API calls or external services.

5. **Depend on other seeds correctly**: If your fixture references data from another seed, import and check that seed's exported records:
   ```typescript
   import { seededUsers } from './users.seed';
   import { seededBookings } from './sessions.seed';
   
   // seededUsers and seededBookings are populated after those seeds run
   ```

## Test Isolation Strategy

### **Transaction-Based Rollback**

All seeds run within a single PostgreSQL transaction:

```typescript
// In src/utils/seed-runner.utils.ts
export async function runSeeds(seeds: SeedFn[], size: SeedSize = 'dev'): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const seed of seeds) {
      await seed(client, size);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK'); // All seeded data removed on error
    throw err;
  } finally {
    client.release();
  }
}
```

**Benefits**:
- Atomicity: All-or-nothing seeding
- Automatic cleanup: Test databases can be reset via `ROLLBACK`
- No dangling records: Failures don't leave partial data

### **Database Reset**

For integration tests that modify seeded data, use `resetDatabase()` to truncate tables in dependency order:

```typescript
// Truncates in order: reviews → transactions → wallets → bookings → users
export async function resetDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      TRUNCATE TABLE
        review_votes, review_reports, reviews,
        transaction_events, transactions,
        wallet_balances, wallets,
        bookings,
        users
      RESTART IDENTITY CASCADE
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

## Seeded Data Reference

After seeds complete, reference exported data:

```typescript
// All seeded users
import { seededUsers } from './users.seed';
const firstMentor = seededUsers.find(u => u.role === 'mentor');

// All seeded bookings
import { seededBookings } from './sessions.seed';
const completedBookings = seededBookings.filter(b => b.status === 'completed');
```

## Environment-Specific Seeding

Seed size is controlled by:

1. **Command-line flag** (highest priority):
   ```bash
   npm run seed --size=test
   ```

2. **Environment variable**:
   ```bash
   SEED_SIZE=test npm run seed
   ```

3. **NODE_ENV** (fallback):
   ```bash
   NODE_ENV=test npm run seed  # Uses test size
   NODE_ENV=production npm run seed  # Uses dev size
   ```

The logic in `seed-runner.utils.ts` applies them in priority order.

## Troubleshooting

### "No mentors/mentees found — run users seed first"
- **Cause**: Another seed depends on `seedUsers` but it hasn't run yet
- **Fix**: Ensure `users.seed` is the first seed in the `SEEDS` array in `index.ts`

### "FOREIGN KEY constraint violation"
- **Cause**: Seed is trying to insert records with invalid parent IDs
- **Fix**: Check dependency order. For example, `sessions.seed` requires `users.seed` to have run first

### Truncate fails with "cannot truncate table"
- **Cause**: Active foreign key constraints, usually from live test connections
- **Fix**: Close all test pools, then retry `resetDatabase()`

### Seeds run slowly
- **Cause**: Large volume of inserts, especially with many mentors/mentees
- **Fix**: Use `--size=test` for unit tests, `--size=dev` for integration tests only when needed

## Reference: Seed Sizes

| Size | Mentors | Mentees | Sessions/Mentor | Total Bookings |
|------|---------|---------|-----------------|----------------|
| test | 2       | 3       | 2               | 4              |
| dev  | 5       | 10      | 5               | 25             |

