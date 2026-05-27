/**
 * Email provider webhook routes — no auth middleware, signature-verified.
 *
 * POST /webhooks/email/sendgrid  — SendGrid event callbacks
 * POST /webhooks/email/mailgun   — Mailgun event callbacks
 */
import { Router } from 'express';
import { EmailWebhookController } from '../controllers/emailWebhook.controller';

const router = Router();

router.post('/sendgrid', EmailWebhookController.sendgrid);
router.post('/mailgun', EmailWebhookController.mailgun);

export default router;
