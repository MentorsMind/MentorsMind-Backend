import { Request, Response, NextFunction } from 'express';
import { TenantModel } from '../models/tenant.model';
import { TenantRecord } from '../types/tenant.types';

export interface TenantRequest extends Request {
  tenant?: TenantRecord;
}

/**
 * Resolves the tenant from the request hostname.
 * Attaches `req.tenant` if a matching active tenant is found.
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
      }
    }
  } catch {
    // Non-fatal: tenant resolution failure should not block requests
  }
  next();
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
