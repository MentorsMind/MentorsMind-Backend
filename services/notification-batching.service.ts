export interface ChannelPreference {
  enabled: boolean;
  priority: number;
}

export interface Notification {
  id: string;
  type: string;
  payload: any;
  createdAt: Date;
}

export interface NotificationBatch {
  userId: string;
  notifications: Notification[];
  batchType: 'immediate' | 'hourly' | 'daily' | 'weekly';
  scheduledAt: Date;
  channel: 'email' | 'push' | 'sms';
}

export interface NotificationPreferences {
  userId: string;
  channels: {
    email: ChannelPreference;
    push: ChannelPreference;
    sms: ChannelPreference;
  };
  quietHours: { start: string; end: string };
  digestFrequency: 'realtime' | 'hourly' | 'daily' | 'weekly';
}

/**
 * Notification batching service stub.
 * Implements simple batching heuristics pending later optimization.
 */
export class NotificationBatchingService {
  async createBatch(batch: NotificationBatch): Promise<void> {
    // TODO: enqueue, group, schedule deliveries
    console.log('Scheduling notification batch for', batch.userId);
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    // Placeholder defaults
    return {
      userId,
      channels: {
        email: { enabled: true, priority: 1 },
        push: { enabled: true, priority: 2 },
        sms: { enabled: false, priority: 3 },
      },
      quietHours: { start: '22:00', end: '07:00' },
      digestFrequency: 'daily',
    };
  }
}

export default new NotificationBatchingService();
