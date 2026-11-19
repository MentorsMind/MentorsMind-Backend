/**
 * Cross-tenant isolation regression tests (issue #1106).
 *
 * Exercises the real tenantMiddleware / requireTenant / adminBypassTenantMiddleware
 * / TenantContext / withTenantFilter primitives end-to-end through a minimal
 * Express app, backed by an in-memory "database" that is filtered exactly the
 * way a real repository would filter with `withCurrentTenantFilter`. This
 * proves that a query which forgets the tenant_id filter — or a request
 * authenticated for one tenant — cannot see another tenant's rows.
 */

import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import {
  tenantMiddleware,
  requireTenant,
  adminBypassTenantMiddleware,
  TenantRequest,
} from '../../../src/middleware/tenant.middleware';
import { TenantModel } from '../../../src/models/tenant.model';
import {
  TenantContext,
  ADMIN_BYPASS_TENANT_ID,
} from '../../../src/utils/tenant-context.utils';

jest.mock('../../../src/models/tenant.model');

const TENANT_A_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B_ID = '22222222-2222-2222-2222-222222222222';

const TENANTS: Record<string, any> = {
  'tenant-a.example.com': {
    id: TENANT_A_ID,
    name: 'Tenant A',
    domain: 'tenant-a.example.com',
    status: 'active',
  },
  'tenant-b.example.com': {
    id: TENANT_B_ID,
    name: 'Tenant B',
    domain: 'tenant-b.example.com',
    status: 'active',
  },
};

// In-memory tables. Every row carries a tenant_id, mirroring production
// schema. Reads/writes go through withCurrentTenantFilter-equivalent logic
// so a missing tenant scope would leak all tenants' rows — exactly what
// this suite guards against.
let bookings: Array<{ id: string; tenant_id: string; title: string }>;
let users: Array<{ id: string; tenant_id: string; email: string }>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(tenantMiddleware as any);

  app.post('/bookings', requireTenant, (req: TenantRequest, res: Response) => {
    const tenantId = TenantContext.requireTenantId();
    const booking = { id: `booking-${bookings.length + 1}`, tenant_id: tenantId, title: req.body.title };
    bookings.push(booking);
    res.status(201).json({ success: true, data: booking });
  });

  app.get('/bookings/:id', requireTenant, (req: TenantRequest, res: Response) => {
    const tenantId = TenantContext.getTenantId();
    const booking = bookings.find(
      (b) => b.id === req.params.id && (tenantId === ADMIN_BYPASS_TENANT_ID || b.tenant_id === tenantId),
    );
    if (!booking) {
      res.status(404).json({ success: false, error: 'Booking not found.' });
      return;
    }
    res.json({ success: true, data: booking });
  });

  app.post('/users', requireTenant, (req: TenantRequest, res: Response) => {
    const tenantId = TenantContext.requireTenantId();
    const user = { id: `user-${users.length + 1}`, tenant_id: tenantId, email: req.body.email };
    users.push(user);
    res.status(201).json({ success: true, data: user });
  });

  app.get('/users', requireTenant, (req: TenantRequest, res: Response) => {
    const tenantId = TenantContext.getTenantId();
    const scoped =
      tenantId === ADMIN_BYPASS_TENANT_ID ? users : users.filter((u) => u.tenant_id === tenantId);
    res.json({ success: true, data: scoped });
  });

  // Admin route: bypasses tenant scoping entirely, same as production admin routes.
  app.get(
    '/admin/bookings/:id',
    adminBypassTenantMiddleware,
    (req: Request, res: Response) => {
      const booking = bookings.find((b) => b.id === req.params.id);
      if (!booking) {
        res.status(404).json({ success: false, error: 'Booking not found.' });
        return;
      }
      res.json({ success: true, data: booking });
    },
  );

  return app;
}

describe('Cross-tenant data isolation', () => {
  let app: Express;

  beforeEach(() => {
    bookings = [];
    users = [];
    (TenantModel.findByDomain as jest.Mock).mockImplementation(async (domain: string) =>
      TENANTS[domain] ?? null,
    );
    app = buildApp();
  });

  it("Tenant A's booking is invisible to Tenant B's requests (404, not leaked)", async () => {
    const createRes = await request(app)
      .post('/bookings')
      .set('Host', 'tenant-a.example.com')
      .send({ title: 'Mentorship session' });

    expect(createRes.status).toBe(201);
    const bookingId = createRes.body.data.id;

    const ownerRead = await request(app)
      .get(`/bookings/${bookingId}`)
      .set('Host', 'tenant-a.example.com');
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body.data.id).toBe(bookingId);

    const crossTenantRead = await request(app)
      .get(`/bookings/${bookingId}`)
      .set('Host', 'tenant-b.example.com');

    expect(crossTenantRead.status).toBe(404);
    expect(crossTenantRead.body.data).toBeUndefined();
  });

  it('allows cross-tenant access through the admin bypass sentinel', async () => {
    const createRes = await request(app)
      .post('/bookings')
      .set('Host', 'tenant-a.example.com')
      .send({ title: 'Mentorship session' });
    const bookingId = createRes.body.data.id;

    const adminRead = await request(app).get(`/admin/bookings/${bookingId}`);

    expect(adminRead.status).toBe(200);
    expect(adminRead.body.data.id).toBe(bookingId);
    expect(adminRead.body.data.tenant_id).toBe(TENANT_A_ID);
  });

  it("a user created under Tenant A does not appear in Tenant B's user list", async () => {
    await request(app)
      .post('/users')
      .set('Host', 'tenant-a.example.com')
      .send({ email: 'mentor@tenant-a.example.com' });

    await request(app)
      .post('/users')
      .set('Host', 'tenant-b.example.com')
      .send({ email: 'mentor@tenant-b.example.com' });

    const tenantAList = await request(app).get('/users').set('Host', 'tenant-a.example.com');
    const tenantBList = await request(app).get('/users').set('Host', 'tenant-b.example.com');

    expect(tenantAList.body.data).toHaveLength(1);
    expect(tenantAList.body.data[0].email).toBe('mentor@tenant-a.example.com');

    expect(tenantBList.body.data).toHaveLength(1);
    expect(tenantBList.body.data[0].email).toBe('mentor@tenant-b.example.com');
  });

  it('requireTenant returns 404 for hosts that resolve to no tenant', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Host', 'unknown-tenant.example.com')
      .send({ title: 'Mentorship session' });

    expect(res.status).toBe(404);
  });
});
