import { Request, Response } from 'express';
import { z } from 'zod';
import { TenantService } from '../services/tenant.service';
import { TenantRequest } from '../middleware/tenant.middleware';

const brandingSchema = z.object({
  logo: z.string().url(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  customCSS: z.string().optional(),
});

const limitsSchema = z.object({
  maxUsers: z.number().int().positive(),
  maxMentors: z.number().int().positive(),
  maxSessions: z.number().int().positive(),
});

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().min(1).max(255),
  branding: brandingSchema,
  features: z.array(z.string()).optional(),
  limits: limitsSchema.optional(),
  status: z.enum(['active', 'suspended', 'trial']).optional(),
});

const updateTenantSchema = createTenantSchema.partial();

export const TenantController = {
  async list(req: Request, res: Response): Promise<void> {
    const { status, page, limit } = req.query;
    const result = await TenantService.list({
      status: status as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json({ success: true, data: result });
  },

  async getById(req: Request, res: Response): Promise<void> {
    const tenant = await TenantService.getById(req.params.id);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }
    res.json({ success: true, data: tenant });
  },

  async getCurrent(req: TenantRequest, res: Response): Promise<void> {
    if (!req.tenant) {
      res.status(404).json({ success: false, error: 'No tenant resolved for this request.' });
      return;
    }
    res.json({ success: true, data: req.tenant });
  },

  async create(req: Request, res: Response): Promise<void> {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }
    const tenant = await TenantService.create(parsed.data);
    res.status(201).json({ success: true, data: tenant });
  },

  async update(req: Request, res: Response): Promise<void> {
    const parsed = updateTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }
    const tenant = await TenantService.update(req.params.id, parsed.data);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }
    res.json({ success: true, data: tenant });
  },
};
