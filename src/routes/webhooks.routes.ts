/**
 * Webhook Routes
 *
 * POST   /api/v1/webhooks                — register a webhook
 * GET    /api/v1/webhooks                — list webhooks for authenticated user
 * GET    /api/v1/webhooks/:id            — get single webhook
 * PUT    /api/v1/webhooks/:id            — update URL, event subscriptions, or filters
 * DELETE /api/v1/webhooks/:id            — remove webhook
 * GET    /api/v1/webhooks/:id/deliveries — delivery history
 * POST   /api/v1/webhooks/:id/test       — send a test event
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { webhookAuth } from '../middleware/webhook-auth.middleware';
import { WebhooksController } from '../controllers/webhooks.controller';
import {
  createWebhookSchema,
  updateWebhookSchema,
  webhookIdParamSchema,
  webhookDeliveriesQuerySchema,
} from '../validators/schemas/webhooks.schemas';

const router = Router();

router.use(authenticate);

router.post('/',      validate(createWebhookSchema),           WebhooksController.create);
router.get('/',                                                 WebhooksController.list);
router.get('/:id',   validate(webhookIdParamSchema),           WebhooksController.getOne);
router.put('/:id',   validate(updateWebhookSchema),            WebhooksController.update);
router.delete('/:id', validate(webhookIdParamSchema),          WebhooksController.remove);
router.get('/:id/deliveries', validate(webhookDeliveriesQuerySchema), WebhooksController.deliveries);
router.post('/:id/test', validate(webhookIdParamSchema),       WebhooksController.test);
// Publicly accessible but API Key protected
router.post('/incoming', webhookAuth, WebhooksController.receive);

// All other webhook routes require JWT authentication
router.use(authenticate);

router.post('/', WebhooksController.create);
router.get('/', WebhooksController.list);
router.get('/:id', WebhooksController.getOne);
router.put('/:id', WebhooksController.update);
router.delete('/:id', WebhooksController.remove);
router.get('/:id/deliveries', WebhooksController.deliveries);
router.post('/:id/test', WebhooksController.test);
router.post('/:id/rotate-api-key', WebhooksController.rotateKey);

export default router;
