**Rollback Procedure**

Purpose

- Provide a safe, repeatable way to roll back database schema migrations for testing and emergency use.

Overview

- We generate heuristic down-SQL files for each existing migration into `database/migrations_down/`.
- Rollbacks are executed in reverse chronological order by `scripts/run-rollbacks.js` which runs each `.down.sql` inside a transaction.

Safety notes

- Auto-generated down SQL may be destructive (DROP TABLE CASCADE). These files include comments and must be reviewed before running against production.
- Always run rollbacks against a fresh staging copy of your database first.

Usage

1. Ensure `DATABASE_URL` points to the database you want to test rollback against (use a disposable test DB).
2. Generate down files:

```bash
npm run migrate:generate-down
```

3. Run migrations up (as in CI):

```bash
npm run migrate:up
```

4. Run rollback test:

```bash
npm run migrate:rollback-test
```

Partial rollback

- To partially rollback, you can manually run the desired `.down.sql` files in `database/migrations_down/` in reverse order.
- The `scripts/run-rollbacks.js` will skip missing files and abort on the first error to avoid half-applied rollbacks.

Maintaining data integrity

- Because schema rollbacks can lose data, preferred approach for production incident recovery is:
  1. Restore a backup to a staging environment
  2. Run down migrations there to verify
  3. Prepare a targeted, careful migration that *preserves* or migrates data (instead of DROP TABLE)

Adding proper down migrations

- The generated down SQL is a starting point. Maintainters should review each `*.down.sql` and replace auto-generated DROP statements with safer downgrade logic where appropriate (e.g., preserve data, rename columns, backfill, move data to archive tables).
