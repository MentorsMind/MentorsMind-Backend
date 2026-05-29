import { QUEUE_NAMES as CONFIG_QUEUE_NAMES } from '../queue';
import { QUEUE_NAMES as QUEUES_QUEUE_NAMES } from '../../queues/queue.config';

describe('QUEUE_NAMES consistency', () => {
  it('should have identical QUEUE_NAMES in both config/queue.ts and queues/queue.config.ts', () => {
    expect(CONFIG_QUEUE_NAMES).toEqual(QUEUES_QUEUE_NAMES);
  });

  it('should contain all required queue names', () => {
    const requiredQueues = [
      'EMAIL',
      'STELLAR_TX',
      'ESCROW_CHECK',
      'ESCROW_RELEASE',
      'NOTIFICATIONS',
      'PAYMENT_POLL',
      'REPORT',
      'EXPORT',
      'SESSION_REMINDER',
      'AUDIT_LOG',
      'NOTIFICATION_CLEANUP',
      'MAINTENANCE',
    ];

    requiredQueues.forEach((queueName) => {
      expect(CONFIG_QUEUE_NAMES).toHaveProperty(queueName);
    });
  });
});
