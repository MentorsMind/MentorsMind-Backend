# Migration Testing

The migration framework validates ordering, applies every numbered SQL file,
checks that tables, primary keys, foreign keys, and migration tracking exist,
measures total and per-migration execution time, and verifies that a disposable
database can be rolled back to an empty public schema.

Run the deterministic framework tests with:

```bash
pnpm run test:migrations
```

Run against a disposable PostgreSQL database only:

```bash
MIGRATION_TEST_ALLOW_DESTRUCTIVE=true \
MIGRATION_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mentorminds_migration_test \
pnpm run test:migrations:run
```

The runner writes `migration-test-report.json` (override with
`MIGRATION_TEST_REPORT`). Set `MIGRATION_PERFORMANCE_BUDGET_MS` to change the
default 120-second migration budget. The runner intentionally refuses to run
without the explicit destructive-operation flag.