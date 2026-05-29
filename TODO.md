# TODO

## Database Query Optimization

1. Inspect GraphQL DataLoader batch functions; identify ineffective batching.
2. Implement bulk-fetch model methods for DataLoader (payments, reviews, bookings/users if needed) to avoid per-id queries.
3. Update `src/graphql/dataloaders/index.ts` to use bulk-fetch methods and return results in input order.
4. Add a new migration that creates missing indexes on foreign keys and frequently-filtered/sorted columns.
5. Verify code compiles logically (no builds/tests executed per instruction).
6. Document expected N+1 reductions and indexing impact.
7. Update TODO as steps are completed.
