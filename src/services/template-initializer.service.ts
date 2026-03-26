import fs from 'fs';
import path from 'path';
import { NotificationTemplatesModel } from '../models/notification-templates.model';
import { logger } from '../utils/logger.utils';

interface TemplateSeed {
  id: string;
  name: string;
  type: 'email';
  subject: string;
  htmlFile: string;
  textFile: string;
  variables: string[];
}

const TEMPLATE_DIR = path.resolve(__dirname, '../templates/emails');

const TEMPLATES: TemplateSeed[] = [
  {
    id: 'booking_confirmed',
    name: 'Booking Confirmed',
    type: 'email',
    subject: 'Your MentorMinds Booking is Confirmed!',
    htmlFile: 'booking-confirmed.html',
    textFile: 'booking-confirmed.txt',
    variables: ['sessionDate', 'sessionTime', 'duration', 'mentorName', 'amount', 'sessionType', 'platformUrl', 'supportUrl'],
  },
  {
    id: 'payment_processed',
    name: 'Payment Processed',
    type: 'email',
    subject: 'Payment Confirmation — MentorMinds',
    htmlFile: 'payment-processed.html',
    textFile: 'payment-processed.txt',
    variables: ['amount', 'transactionId', 'paymentDate', 'purpose', 'status', 'transactionUrl', 'platformUrl', 'supportUrl'],
  },
  {
    id: 'session_reminder',
    name: 'Session Reminder',
    type: 'email',
    subject: 'Your MentorMinds Session is Coming Up!',
    htmlFile: 'session-reminder.html',
    textFile: 'session-reminder.txt',
    variables: ['timeUntil', 'mentorName', 'sessionTime', 'duration', 'meetingUrl', 'platformUrl', 'supportUrl'],
  },
  {
    id: 'dispute_created',
    name: 'Dispute Created',
    type: 'email',
    subject: 'Dispute Filed — MentorMinds',
    htmlFile: 'dispute-created.html',
    textFile: 'dispute-created.txt',
    variables: ['disputeId', 'sessionTitle', 'amount', 'reason', 'platformUrl', 'supportUrl'],
  },
  {
    id: 'session_cancelled',
    name: 'Session Cancelled',
    type: 'email',
    subject: 'Session Cancelled — MentorMinds',
    htmlFile: 'session-cancelled.html',
    textFile: 'session-cancelled.txt',
    variables: ['sessionTitle', 'sessionDate', 'sessionTime', 'cancelledBy', 'reason', 'refundStatus', 'platformUrl', 'supportUrl'],
  },
  {
    id: 'welcome',
    name: 'Welcome',
    type: 'email',
    subject: 'Welcome to MentorMinds!',
    htmlFile: 'welcome.html',
    textFile: 'welcome.txt',
    variables: ['userName', 'platformUrl', 'supportUrl'],
  },
];

function readFile(filename: string): string {
  const filePath = path.join(TEMPLATE_DIR, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    logger.warn(`Template file not found: ${filePath}`);
    return '';
  }
}

/**
 * Seed or update all email templates in the database.
 * Safe to call on every startup — uses upsert logic.
 */
export async function initializeEmailTemplates(): Promise<void> {
  let seeded = 0;

  for (const tpl of TEMPLATES) {
    try {
      const existing = await NotificationTemplatesModel.getById(tpl.id);
      if (existing) continue; // already present, skip

      await NotificationTemplatesModel.create({
        id: tpl.id,
        name: tpl.name,
        type: tpl.type,
        subject: tpl.subject,
        html_content: readFile(tpl.htmlFile),
        text_content: readFile(tpl.textFile),
        variables: tpl.variables,
      });
      seeded++;
    } catch (error) {
      logger.error(`Failed to seed template ${tpl.id}:`, error);
    }
  }

  if (seeded > 0) {
    logger.info(`Email templates: seeded ${seeded} new template(s)`);
  }
}
