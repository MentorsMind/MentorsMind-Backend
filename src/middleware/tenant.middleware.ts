import { Request, Response, NextFunction } from 'express';
import { TenantModel } from '../models/tenant.model';
import { TenantRecord } from '../types/tenant.types';
import { TenantContext, ADMIN_BYPASS_TENANT_ID } from '../utils/tenant-context.utils';

export interface TenantRequest extends Request {
  tenant?: TenantRecord;
}

/**
 * Resolves the tenant from the request hostname.
 *
 * Attaches `req.tenant` if a matching active tenant is found.
 * Also populates the AsyncLocalStorage TenantContext so that all downstream
 * database queries automatically receive the correct tenant filter.
 *
 * Tenant context is scoped exclusively to each request via AsyncLocalStorage:
 * every code path calls next() inside a TenantContext.run() callback, so the
 * store is always created fresh for each request and torn down automatically
 * when the callback returns. Concurrent requests on the same connection cannot
 * share or leak each other's tenant context.
 *
 * Continues without error if no tenant matches (single-tenant fallback).
 */
export const tenantMiddleware = async (
  req: TenantRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const hostname = req.hostname;
    if (hostname) {
      const tenant = await TenantModel.findByDomain(hostname);
      if (tenant) {
        req.tenant = tenant;
        // Populate AsyncLocalStorage so all DB queries in this request
        // context automatically carry the tenant ID.
        TenantContext.run(tenant.id, () => next());
        return;
      }
    }
  } catch {
    // Non-fatal: tenant resolution failure should not block requests
  }
  // No tenant resolved — run without a tenant context (null = no filter).
  TenantContext.run(null, () => next());
};

/**
 * Middleware that requires a resolved tenant on the request.
 * Returns 404 if no tenant is found for the hostname.
 */
export const requireTenant = (
  req: TenantRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.tenant) {
    res.status(404).json({ success: false, error: 'Tenant not found.' });
    return;
  }
  next();
};

/**
 * Middleware that runs the rest of the request chain in an admin bypass
 * context, allowing cross-tenant queries.
 *
 * Usage: apply AFTER authenticate + requireAdmin to admin-only routes.
 */
export const adminBypassTenantMiddleware = (
  _req: TenantRequest,
  _res: Response,
  next: NextFunction,
): void => {
  TenantContext.run(ADMIN_BYPASS_TENANT_ID, () => next());
};
