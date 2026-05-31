import { Request, Response, NextFunction } from 'express';
import { FeatureFlagService, CreateFlagInput, UpdateFlagInput } from '../services/feature-flag.service';
import { logger } from '../utils/logger.utils';

export const FeatureFlagController = {
  // ── Admin CRUD ──────────────────────────────────────────────────────────────

  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const flags = await FeatureFlagService.findAll();
      res.json({ success: true, data: flags });
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const flag = await FeatureFlagService.findById(String(req.params.id));
      if (!flag) { res.status(404).json({ success: false, error: 'Feature flag not found' }); return; }
      res.json({ success: true, data: flag });
    } catch (err) {
      next(err);
    }
  },

  async getByKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const flag = await FeatureFlagService.findByKey(String(req.params.key));
      if (!flag) { res.status(404).json({ success: false, error: 'Feature flag not found' }); return; }
      res.json({ success: true, data: flag });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input: CreateFlagInput = {
        ...req.body,
        createdBy: (req as Request & { user?: { userId: string } }).user?.userId,
      };
      const flag = await FeatureFlagService.create(input);
      res.status(201).json({ success: true, data: flag });
    } catch (err) {
      logger.error({ err }, 'FeatureFlagController.create error');
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input: UpdateFlagInput = {
        ...req.body,
        updatedBy: (req as Request & { user?: { userId: string } }).user?.userId,
      };
      const flag = await FeatureFlagService.update(String(req.params.id), input);
      if (!flag) { res.status(404).json({ success: false, error: 'Feature flag not found' }); return; }
      res.json({ success: true, data: flag });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const deleted = await FeatureFlagService.delete(String(req.params.id));
      if (!deleted) { res.status(404).json({ success: false, error: 'Feature flag not found' }); return; }
      res.json({ success: true, message: 'Feature flag deleted' });
    } catch (err) {
      next(err);
    }
  },

  // ── Kill switch ─────────────────────────────────────────────────────────────

  async disable(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const updatedBy = (req as Request & { user?: { userId: string } }).user?.userId;
      const flag = await FeatureFlagService.update(String(req.params.id), { enabled: false, updatedBy });
      if (!flag) { res.status(404).json({ success: false, error: 'Feature flag not found' }); return; }
      res.json({ success: true, data: flag, message: 'Feature flag disabled (kill switch activated)' });
    } catch (err) {
      next(err);
    }
  },

  // ── Evaluation (client-facing) ───────────────────────────────────────────────

  async evaluate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = String(req.params.key);
      const userId = req.query.userId as string;
      if (!userId) { res.status(400).json({ success: false, error: 'userId is required' }); return; }

      const context = {
        segment: req.query.segment as string | undefined,
        tenantId: req.query.tenantId as string | undefined,
      };

      const [enabled, variant] = await Promise.all([
        FeatureFlagService.isEnabled(key, userId, context),
        FeatureFlagService.getVariant(key, userId, context),
      ]);

      // Track exposure
      await FeatureFlagService.trackEvent(key, userId, 'exposure', variant?.name);

      res.json({ success: true, data: { key, enabled, variant } });
    } catch (err) {
      next(err);
    }
  },

  // ── Metrics ─────────────────────────────────────────────────────────────────

  async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const since = req.query.since ? new Date(req.query.since as string) : undefined;
      const metrics = await FeatureFlagService.getMetrics(String(req.params.key), since);
      res.json({ success: true, data: metrics });
    } catch (err) {
      next(err);
    }
  },

  async trackConversion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = String(req.params.key);
      const { userId, variant, metadata } = req.body;
      if (!userId) { res.status(400).json({ success: false, error: 'userId is required' }); return; }
      await FeatureFlagService.trackEvent(key, userId, 'conversion', variant, metadata);
      res.json({ success: true, message: 'Conversion tracked' });
    } catch (err) {
      next(err);
    }
  },
};
