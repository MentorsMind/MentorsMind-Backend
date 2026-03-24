import { WsService } from '../../services/ws.service';
import { logger } from '../../utils/logger.utils';

export interface BookingNotificationPayload {
  bookingId: string;
  mentorId: string;
  menteeId: string;
  scheduledAt: string;
  topic: string;
  status: string;
}

export interface SessionStatusPayload {
  sessionId: string;
  userId: string;
  status: string;
  meetingUrl?: string;
}

/**
 * Notify both mentor and mentee when a booking is confirmed.
 */
export async function notifyBookingConfirmed(
  payload: BookingNotificationPayload,
): Promise<void> {
  const { mentorId, menteeId, bookingId, scheduledAt, topic, status } = payload;

  const menteeMsg = {
    event: 'booking:confirmed',
    data: { bookingId, scheduledAt, topic, status },
  };

  const mentorMsg = {
    event: 'booking:new',
    data: { bookingId, scheduledAt, topic, menteeId },
  };

  await Promise.all([
    WsService.publish(menteeId, menteeMsg.event, menteeMsg.data),
    WsService.publish(mentorId, mentorMsg.event, mentorMsg.data),
  ]);

  logger.info('WS notification: booking confirmed', {
    bookingId,
    mentorId,
    menteeId,
  });
}

/**
 * Notify a user when a booking is cancelled.
 */
export async function notifyBookingCancelled(
  payload: BookingNotificationPayload,
): Promise<void> {
  const { mentorId, menteeId, bookingId } = payload;

  await Promise.all([
    WsService.publish(menteeId, 'booking:cancelled', { bookingId }),
    WsService.publish(mentorId, 'booking:cancelled', { bookingId, menteeId }),
  ]);

  logger.info('WS notification: booking cancelled', { bookingId });
}

/**
 * Push a session status update to the relevant user.
 */
export async function notifySessionStatus(
  payload: SessionStatusPayload,
): Promise<void> {
  const { userId, sessionId, status, meetingUrl } = payload;

  await WsService.publish(userId, 'session:status', {
    sessionId,
    status,
    meetingUrl,
  });

  logger.info('WS notification: session status', { userId, sessionId, status });
}
