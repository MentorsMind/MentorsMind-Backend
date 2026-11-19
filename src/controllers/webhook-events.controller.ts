import { Request, Response } from 'express';
import { WebhookIdempotencyService } from '../services/webhook-idempotency.service';
import { ResponseUtil } from '../utils/response.utils';
import { asyncHandler } from '../utils/asyncHandler.utils';

/**
 * Admin endpoints for inspecting and replaying inbound webhook events (issue #979).
 */
export const WebhookEventsController = {
  /**
   * GET /api/v1/admin/webhooks/events
   * List recently received inbound webhook events.
   */
  list: asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
    const offset = parseInt((req.query.offset as string) ?? '0', 10);
    const { rows, total } = await WebhookIdempotencyService.list(limit, offset);
    return ResponseUtil.success(res, { events: rows, total, limit, offset });
  }),

  /**
   * POST /api/v1/admin/webhooks/events/:id/replay
   * Reprocess a specific inbound webhook event. Clears the idempotency claim
   * and re-dispatches the stored payload to the applicable handler.
   */
  replay: asyncHandler(async (req: Request, res: Response) => {
    const id = (req.params as { id: string }).id;
    const record = await WebhookIdempotencyService.findById(id);
    if (!record) return ResponseUtil.notFound(res, 'Webhook event not found');

    // Dispatch the stored payload back through the same processing path.
    let dispatchError: string | null = null;
    try {
      if (record.provider === 'sendgrid') {
        const { EmailWebhookService } = await import('../services/emailWebhook.service');
        await EmailWebhookService.processSendGridEvents(
          Array.isArray(record.payload) ? record.payload : [record.payload as any],
        );
      } else if (record.provider === 'mailgun') {
        const { EmailWebhookService } = await import('../services/emailWebhook.service');
        await EmailWebhookService.processMailgunEvent(record.payload as any);
      } else {
        dispatchError = `No replay handler for provider: ${record.provider}`;
      }
    } catch (error) {
      dispatchError = error instanceof Error ? error.message : String(error);
    }

    if (dispatchError) {
      return ResponseUtil.error(res, `Replay failed: ${dispatchError}`, 500);
    }

    await WebhookIdempotencyService.markReplayed(id, record.provider, record.eventId);
    return ResponseUtil.success(res, { replayed: true, eventId: record.id }, 'Webhook event replayed');
  }),
};
