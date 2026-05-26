import { Request, Response } from 'express';
import { EmailWebhookService } from '../services/emailWebhook.service';
import { logger } from '../utils/logger';

export const EmailWebhookController = {
  /**
   * POST /webhooks/email/sendgrid
   * Receives delivery events (delivered, bounce, spam, open, click) from SendGrid.
   */
  async sendgrid(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['x-twilio-email-event-webhook-signature'] as string || '';
      const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'] as string || '';
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);

      if (signature && timestamp) {
        const valid = EmailWebhookService.verifySendGridSignature(rawBody, signature, timestamp);
        if (!valid) {
          logger.warn('SendGrid webhook signature verification failed');
          res.status(403).json({ error: 'Invalid signature' });
          return;
        }
      }

      const events = Array.isArray(req.body) ? req.body : [req.body];
      await EmailWebhookService.processSendGridEvents(events);

      // SendGrid expects a 2xx response quickly
      res.status(200).json({ received: events.length });
    } catch (err) {
      logger.error('SendGrid webhook processing error', { err });
      res.status(500).json({ error: 'Internal error' });
    }
  },

  /**
   * POST /webhooks/email/mailgun
   * Receives delivery events from Mailgun.
   */
  async mailgun(req: Request, res: Response): Promise<void> {
    try {
      const sig = req.body?.signature;

      if (sig?.timestamp && sig?.token && sig?.signature) {
        const valid = EmailWebhookService.verifyMailgunSignature(
          sig.timestamp,
          sig.token,
          sig.signature,
        );
        if (!valid) {
          logger.warn('Mailgun webhook signature verification failed');
          res.status(403).json({ error: 'Invalid signature' });
          return;
        }
      }

      const eventData = req.body?.['event-data'] || req.body;
      await EmailWebhookService.processMailgunEvent(eventData);

      res.status(200).json({ received: true });
    } catch (err) {
      logger.error('Mailgun webhook processing error', { err });
      res.status(500).json({ error: 'Internal error' });
    }
  },
};
