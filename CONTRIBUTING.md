# Contributing to MentorsMind Backend

## Tenant isolation for database queries

MentorsMind is multi-tenant. Every query that touches tenant-scoped data
(`users`, `bookings`, `sessions`, and any table with a `tenant_id` column) must
be scoped to the current tenant. Isolation is enforced in two layers, and new
code must use both:

1. **Application filter:** `withTenantFilter` / `withCurrentTenantFilter` in
   [`src/utils/tenant-context.utils.ts`](src/utils/tenant-context.utils.ts)
   add `AND tenant_id = $N` to your SQL.
2. **Row Level Security:** `TenantPoolManager` in
   [`src/config/database.ts`](src/config/database.ts) sets the `app.tenant_id`
   session variable that the RLS policies from
   `database/migrations/106_add_tenant_id_and_rls.sql` check.

### The pattern

```ts
import { TenantPoolManager } from '../config/database';
import { TenantContext, withTenantFilter } from '../utils/tenant-context.utils';

const tenantId = TenantContext.requireTenantId();
const rows = await TenantPoolManager.withClient(tenantId, async (client) => {
  const { query, params } = withTenantFilter(
    'SELECT * FROM bookings WHERE mentor_id = $1', [mentorId], tenantId);
  return (await client.query(query, params)).rows;
});
```

### Rules

- **Read the tenant ID from `TenantContext`.** Never take it from request
  bodies, query strings or headers. `tenantMiddleware` sets it for HTTP
  requests.
- **Establish a context outside HTTP.** Background jobs, queue workers, cron
  tasks and scripts have no request, so wrap their work in
  `TenantContext.run(tenantId, async () => { ... })`. Without it,
  `getTenantId()` returns `null` and nothing is filtered.
- **Prefer `requireTenantId()` over `getTenantId()`** when a tenant is
  mandatory, so a missing context fails loudly instead of returning every
  tenant's rows.
- **Don't use the plain `pool` / `db` exports for tenant-scoped tables.** They
  don't set `app.tenant_id`, and RLS treats an empty setting as unfiltered.
- **`null`, empty string or a malformed ID all mean "no filtering"** in both
  layers. `TenantPoolManager` logs and falls back to no filtering for
  non-UUID values rather than throwing.
- **The admin bypass sentinel (`ADMIN_BYPASS_TENANT_ID`, `'__ADMIN_BYPASS__'`)
  is for cross-tenant admin routes only.** Apply it with
  `adminBypassTenantMiddleware` after `authenticate` + `requireAdmin`. Never
  build it from user input.
- **New tenant-scoped tables** need a `tenant_id` column, an index on it, RLS
  enabled, and a `tenant_isolation` policy that follows migration 106.

### Review checklist

- [ ] Every new query on a tenant-scoped table goes through
      `TenantPoolManager` and `withTenantFilter`.
- [ ] The tenant ID comes from `TenantContext`, not from user input.
- [ ] Non-HTTP entry points wrap their work in `TenantContext.run()`.
- [ ] Any use of the admin bypass is on an admin-only route.
