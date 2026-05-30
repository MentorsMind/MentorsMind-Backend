import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { WebhookService } from '../services/webhook.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

export const WebhooksController = {
  /**
   * POST /api/v1/webhooks
   * Register a new webhook endpoint.
   * Validation is handled upstream by the validate(createWebhookSchema) middleware.
   */
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { url, event_types, description, resource_types = [], filter_statuses = [] } = req.body;

    const webhook = await WebhookService.create(
      userId,
      url,
      event_types,
      description,
      resource_types,
      filter_statuses,
    );

    return ResponseUtil.created(res, {
      webhook: {
        id: webhook.id,
        url: webhook.url,
        event_types: webhook.event_types,
        resource_types: webhook.resource_types,
        filter_statuses: webhook.filter_statuses,
        is_active: webhook.is_active,
        description: webhook.description,
        created_at: webhook.created_at,
        secret: webhook.secret_plain,
        api_key: webhook.api_key_plain,
      },
    }, 'Webhook registered. Store the secret and API key securely — they will not be shown again.');
  }),

  /**
   * GET /api/v1/webhooks
   * List all webhooks for the authenticated user.
   */
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const webhooks = await WebhookService.listByUser(userId);
    return ResponseUtil.success(res, { webhooks });
  }),

  /**
   * GET /api/v1/webhooks/:id
   * Get a single webhook (no secret returned).
   */
  getOne: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const webhook = await WebhookService.findById(req.params.id, userId);
    if (!webhook) return ResponseUtil.notFound(res, 'Webhook not found');

    const { secret_plain: _s, ...safe } = webhook;
    return ResponseUtil.success(res, { webhook: safe });
  }),

  /**
   * PUT /api/v1/webhooks/:id
   * Update URL, event subscriptions, or filters.
   * Validation is handled upstream by the validate(updateWebhookSchema) middleware.
   */
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { url, event_types, description, resource_types, filter_statuses } = req.body;

    const updated = await WebhookService.update(req.params.id, userId, {
      url,
      eventTypes: event_types,
      description,
      resourceTypes: resource_types,
      filterStatuses: filter_statuses,
    });

    if (!updated) return ResponseUtil.notFound(res, 'Webhook not found');

    const { secret_plain: _s, ...safe } = updated;
    return ResponseUtil.success(res, { webhook: safe }, 'Webhook updated');
  }),

  /**
   * DELETE /api/v1/webhooks/:id
   */
  remove: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const deleted = await WebhookService.delete(req.params.id, userId);
    if (!deleted) return ResponseUtil.notFound(res, 'Webhook not found');
    return ResponseUtil.success(res, null, 'Webhook deleted');
  }),

  /**
   * GET /api/v1/webhooks/:id/deliveries
   * Delivery history with status and response.
   */
  deliveries: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 100);
    const offset = parseInt((req.query.offset as string) ?? '0', 10);

    const { deliveries, total } = await WebhookService.getDeliveries(
      req.params.id,
      userId,
      limit,
      offset,
    );

    if (deliveries.length === 0 && offset === 0) {
      const webhook = await WebhookService.findById(req.params.id, userId);
      if (!webhook) return ResponseUtil.notFound(res, 'Webhook not found');
    }

    return ResponseUtil.success(res, { deliveries, total, limit, offset });
  }),

  /**
   * POST /api/v1/webhooks/:id/test
   * Send a test event to the endpoint.
   */
  test: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    try {
      const result = await WebhookService.sendTest(req.params.id, userId);
      return ResponseUtil.success(res, result, 'Test event queued for delivery');
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message: string };
      return ResponseUtil.error(res, e.message, e.statusCode ?? 500);
    }
  }),

  /**
   * POST /api/v1/webhooks/:id/rotate-api-key
   * Rotate the API key for a webhook.
   */
  rotateKey: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { grace_period_hours } = req.body;

    const webhook = await WebhookService.rotateApiKey(
      req.params.id,
      userId,
      grace_period_hours ? parseInt(grace_period_hours, 10) : 24
    );

    if (!webhook) return ResponseUtil.notFound(res, 'Webhook not found');

    return ResponseUtil.success(res, {
      api_key: webhook.api_key_plain,
      grace_period_end: webhook.api_key_grace_period_end,
    }, 'API key rotated. The new key is shown above. Store it securely.');
  }),

  /**
   * POST /api/v1/webhooks/incoming
   * Generic receiver for incoming webhooks (requires API key).
   */
  receive: asyncHandler(async (req: Request, res: Response) => {
    // This endpoint is protected by webhookAuth middleware
    const webhook = (req as any).webhook as WebhookRecord;
    
    logger.info('Incoming webhook received', {
      webhookId: webhook.id,
      payload: req.body
    });

    // In a real system, we might enqueue this for processing
    // For now, we just acknowledge receipt
    return ResponseUtil.success(res, { received: true }, 'Webhook received and authenticated');
  }),
};
