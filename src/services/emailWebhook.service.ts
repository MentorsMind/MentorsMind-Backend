import crypto from 'crypto';
import config from '../config';
import { NotificationDeliveryTrackingModel, DeliveryStatus } from '../models/notification-delivery-tracking.model';
import { logger } from '../utils/logger';

export interface SendGridEvent {
  event: string;
  email: string;
  timestamp: number;
  sg_message_id?: string;
  tracking_id?: string;
  reason?: string;
  type?: string;
  url?: string;
  useragent?: string;
  ip?: string;
  custom_args?: Record<string, string>;
}

export interface MailgunEvent {
  event: string;
  recipient: string;
  timestamp: string;
  id?: string;
  message?: { headers?: { 'message-id'?: string } };
  reason?: string;
  description?: string;
  url?: string;
  'user-variables'?: Record<string, string>;
}

const SENDGRID_EVENT_MAP: Record<string, DeliveryStatus> = {
  delivered: DeliveryStatus.DELIVERED,
  bounce: DeliveryStatus.BOUNCED,
  blocked: DeliveryStatus.BOUNCED,
  spam_report: DeliveryStatus.FAILED,
  unsubscribe: DeliveryStatus.FAILED,
  open: DeliveryStatus.OPENED,
  click: DeliveryStatus.CLICKED,
  deferred: DeliveryStatus.QUEUED,
  dropped: DeliveryStatus.FAILED,
};

const MAILGUN_EVENT_MAP: Record<string, DeliveryStatus> = {
  delivered: DeliveryStatus.DELIVERED,
  bounced: DeliveryStatus.BOUNCED,
  failed: DeliveryStatus.FAILED,
  complained: DeliveryStatus.FAILED,
  unsubscribed: DeliveryStatus.FAILED,
  opened: DeliveryStatus.OPENED,
  clicked: DeliveryStatus.CLICKED,
};

export const EmailWebhookService = {
  /**
   * Verify SendGrid webhook signature.
   * SendGrid signs payloads with ECDSA using the public key from the dashboard.
   * For simplicity we verify via a shared secret if configured, otherwise skip.
   */
  verifySendGridSignature(
    payload: string,
    signature: string,
    timestamp: string,
  ): boolean {
    const secret = config.email.webhookSecret;
    if (!secret) return true; // skip verification if not configured

    const data = timestamp + payload;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  },

  /**
   * Verify Mailgun webhook signature.
   * https://documentation.mailgun.com/docs/mailgun/user-manual/tracking-messages/#securing-webhooks
   */
  verifyMailgunSignature(
    timestamp: string,
    token: string,
    signature: string,
  ): boolean {
    const secret = config.email.webhookSecret;
    if (!secret) return true;

    const data = timestamp + token;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  },

  /**
   * Process a batch of SendGrid webhook events.
   */
  async processSendGridEvents(events: SendGridEvent[]): Promise<void> {
    for (const event of events) {
      try {
        const status = SENDGRID_EVENT_MAP[event.event];
        if (!status) continue;

        const trackingId = event.custom_args?.tracking_id || event.tracking_id;
        const messageId = event.sg_message_id;

        logger.info('SendGrid event received', {
          event: event.event,
          email: event.email,
          trackingId,
          messageId,
        });

        if (trackingId) {
          await NotificationDeliveryTrackingModel.create({
            notification_id: trackingId,
            status,
            channel: 'email',
            provider: 'SendGrid',
            external_id: messageId,
            error_message: event.reason,
            metadata: {
              event: event.event,
              email: event.email,
              timestamp: event.timestamp,
              reason: event.reason,
              type: event.type,
            },
          });
        }

        if (status === DeliveryStatus.BOUNCED || status === DeliveryStatus.FAILED) {
          logger.warn('Email bounce/complaint received', {
            provider: 'SendGrid',
            event: event.event,
            email: event.email,
            reason: event.reason,
          });
        }
      } catch (err) {
        logger.error('Failed to process SendGrid event', { err, event });
      }
    }
  },

  /**
   * Process a single Mailgun webhook event.
   */
  async processMailgunEvent(eventData: MailgunEvent): Promise<void> {
    try {
      const status = MAILGUN_EVENT_MAP[eventData.event];
      if (!status) return;

      const trackingId = eventData['user-variables']?.tracking_id;
      const messageId = eventData.message?.headers?.['message-id'] || eventData.id;

      logger.info('Mailgun event received', {
        event: eventData.event,
        recipient: eventData.recipient,
        trackingId,
        messageId,
      });

      if (trackingId) {
        await NotificationDeliveryTrackingModel.create({
          notification_id: trackingId,
          status,
          channel: 'email',
          provider: 'Mailgun',
          external_id: messageId,
          error_message: eventData.reason || eventData.description,
          metadata: {
            event: eventData.event,
            recipient: eventData.recipient,
            timestamp: eventData.timestamp,
            reason: eventData.reason,
          },
        });
      }

      if (status === DeliveryStatus.BOUNCED || status === DeliveryStatus.FAILED) {
        logger.warn('Email bounce/complaint received', {
          provider: 'Mailgun',
          event: eventData.event,
          recipient: eventData.recipient,
          reason: eventData.reason,
        });
      }
    } catch (err) {
      logger.error('Failed to process Mailgun event', { err, event: eventData });
    }
  },
};
