import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { WebhookService, SUPPORTED_EVENT_TYPES } from '../services/webhook.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

export const WebhooksController = {
  /**
   * POST /api/v1/webhooks
   * Register a new webhook endpoint.
   */
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { url, event_types, description } = req.body;

    if (!url || typeof url !== 'string') {
      return ResponseUtil.error(res, 'url is required', 400);
    }

    try {
      new URL(url);
    } catch {
      return ResponseUtil.error(res, 'url must be a valid URL', 400);
    }

    if (!Array.isArray(event_types) || event_types.length === 0) {
      return ResponseUtil.error(res, 'event_types must be a non-empty array', 400);
    }

    const invalid = event_types.filter(
      (e: unknown) => !SUPPORTED_EVENT_TYPES.includes(e as any),
    );
    if (invalid.length > 0) {
      return ResponseUtil.error(
        res,
        `Unsupported event types: ${invalid.join(', ')}. Supported: ${SUPPORTED_EVENT_TYPES.join(', ')}`,
        400,
      );
    }

    const webhook = await WebhookService.create(userId, url, event_types, description);

    // Return the plain secret only on creation — never again
    return ResponseUtil.created(res, {
      webhook: {
        id: webhook.id,
        url: webhook.url,
        event_types: webhook.event_types,
        is_active: webhook.is_active,
        description: webhook.description,
        created_at: webhook.created_at,
        // Shown once — store it securely
        secret: webhook.secret_plain,
      },
    }, 'Webhook registered. Store the secret securely — it will not be shown again.');
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
   * Update URL or event subscriptions.
   */
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { url, event_types, description } = req.body;

    if (url !== undefined) {
      try {
        new URL(url);
      } catch {
        return ResponseUtil.error(res, 'url must be a valid URL', 400);
      }
    }

    if (event_types !== undefined) {
      if (!Array.isArray(event_types) || event_types.length === 0) {
        return ResponseUtil.error(res, 'event_types must be a non-empty array', 400);
      }
      const invalid = event_types.filter(
        (e: unknown) => !SUPPORTED_EVENT_TYPES.includes(e as any),
      );
      if (invalid.length > 0) {
        return ResponseUtil.error(
          res,
          `Unsupported event types: ${invalid.join(', ')}`,
          400,
        );
      }
    }

    const updated = await WebhookService.update(req.params.id, userId, {
      url,
      eventTypes: event_types,
      description,
    });

    if (!updated) return ResponseUtil.notFound(res, 'Webhook not found');

    const { secret_plain: _s, ...safe } = updated;
    return ResponseUtil.success(res, { webhook: safe }, 'Webhook updated');
  }),

  /**
   * DELETE /api/v1/webhooks/:id
   * Remove a webhook.
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
      // Could be not found or genuinely empty — check ownership
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
    } catch (err: any) {
      const status = err.statusCode ?? 500;
      return ResponseUtil.error(res, err.message, status);
    }
  }),
};
