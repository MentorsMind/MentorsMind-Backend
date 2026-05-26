/**
 * Webhook Routes
 *
 * POST   /api/v1/webhooks                    — register a webhook
 * GET    /api/v1/webhooks                    — list webhooks for authenticated user
 * GET    /api/v1/webhooks/:id                — get single webhook
 * PUT    /api/v1/webhooks/:id                — update URL or event subscriptions
 * DELETE /api/v1/webhooks/:id                — remove webhook
 * GET    /api/v1/webhooks/:id/deliveries     — delivery history
 * POST   /api/v1/webhooks/:id/test           — send a test event
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { webhookAuth } from '../middleware/webhook-auth.middleware';
import { WebhooksController } from '../controllers/webhooks.controller';

const router = Router();

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
