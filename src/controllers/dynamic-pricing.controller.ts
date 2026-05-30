import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { DynamicPricingService } from '../services/dynamic-pricing.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

export const DynamicPricingController = {
  getMarketDemand: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { skill, category, period, limit } = req.query;
    const data = await DynamicPricingService.getMarketDemand(
      skill as string | undefined,
      category as string | undefined,
      (period as string) || 'monthly',
      limit ? parseInt(limit as string, 10) : 12,
    );
    return ResponseUtil.success(res, { metrics: data });
  }),

  getBenchmarks: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { category, skill } = req.query;
    const data = await DynamicPricingService.getBenchmarks(
      category as string | undefined,
      skill as string | undefined,
    );
    return ResponseUtil.success(res, { benchmarks: data });
  }),

  getRecommendation: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const data = await DynamicPricingService.getRecommendation(userId);
    if (!data) return ResponseUtil.notFound(res, 'Unable to generate recommendation');
    return ResponseUtil.success(res, { recommendation: data });
  }),

  applyRecommendation: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { price } = req.body;
    if (typeof price !== 'number' || price < 0) {
      return ResponseUtil.error(res, 'Valid price is required', 400);
    }
    await DynamicPricingService.applyRecommendation(userId, price);
    return ResponseUtil.success(res, null, 'Pricing updated successfully');
  }),

  getExperiments: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const data = await DynamicPricingService.getExperiments(userId);
    return ResponseUtil.success(res, { experiments: data });
  }),

  createExperiment: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { name, description, control_price, variant_prices, start_at, end_at } = req.body;

    if (!name || typeof control_price !== 'number' || !Array.isArray(variant_prices) || variant_prices.length === 0) {
      return ResponseUtil.error(res, 'name, control_price, and variant_prices are required', 400);
    }

    const experiment = await DynamicPricingService.createExperiment(
      userId, name, description, control_price, variant_prices, start_at, end_at,
    );
    return ResponseUtil.created(res, { experiment }, 'Pricing experiment created');
  }),

  updateExperimentStatus: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['draft', 'running', 'paused', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return ResponseUtil.error(res, `Status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const experiment = await DynamicPricingService.updateExperimentStatus(id, userId, status);
    if (!experiment) return ResponseUtil.notFound(res, 'Experiment not found');
    return ResponseUtil.success(res, { experiment }, `Experiment ${status}`);
  }),

  getDashboard: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const stats = await DynamicPricingService.getDashboardStats(userId);
    return ResponseUtil.success(res, stats);
  }),
};
