import axios, { AxiosError } from 'axios';
import meetingConfig, { MeetingProvider } from '../config/meeting.config';
import { calculateMeetingExpiry, generateJitsiRoomName } from '../utils/meeting.utils';
import { logger } from '../utils/logger';

export interface MeetingRoomOptions {
  sessionId: string;
  scheduledAt: Date;
  durationMinutes: number;
  mentorName: string;
  menteeName: string;
}

export interface MeetingRoomResult {
  meetingUrl: string;
  roomId: string;
  expiresAt: Date;
  provider: MeetingProvider;
}

interface DailyRoomResponse {
  id: string;
  name: string;
  url: string;
  created_at: string;
  config: {
    exp: number;
  };
}

interface WherebyRoomResponse {
  room_id: string;
  url: string;
  viewer_room_url: string;
  host_room_url: string;
}

interface ZoomMeetingResponse {
  id: string;
  join_url: string;
  start_url: string;
}

/**
 * Create Daily.co room
 */
async function createDailyRoom(
  sessionId: string,
  expiresAt: Date,
  _options: MeetingRoomOptions
): Promise<MeetingRoomResult> {
  const roomName = `mentorminds-${sessionId}`;
  const exp = Math.floor(expiresAt.getTime() / 1000);

  const response = await axios.post<DailyRoomResponse>(
    `${meetingConfig.baseUrl}/rooms`,
    {
      name: roomName,
      config: {
        exp,
        enable_chat: true,
        enable_knocking: false,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${meetingConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    meetingUrl: response.data.url,
    roomId: response.data.id,
    expiresAt,
    provider: MeetingProvider.DAILY,
  };
}

/**
 * Create Whereby room
 */
async function createWherebyRoom(
  sessionId: string,
  expiresAt: Date,
  _options: MeetingRoomOptions
): Promise<MeetingRoomResult> {
  const response = await axios.post<WherebyRoomResponse>(
    `${meetingConfig.baseUrl}/meetings`,
    {
      endDate: expiresAt.toISOString(),
      hostRoom: true,
      viewerRoom: true,
    },
    {
      headers: {
        Authorization: `Bearer ${meetingConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    meetingUrl: response.data.url,
    roomId: response.data.room_id,
    expiresAt,
    provider: MeetingProvider.WHEREBY,
  };
}

/**
 * Create Zoom meeting
 */
async function createZoomMeeting(
  _sessionId: string,
  expiresAt: Date,
  options: MeetingRoomOptions
): Promise<MeetingRoomResult> {
  const scheduledAt = options.scheduledAt;

  const response = await axios.post<ZoomMeetingResponse>(
    `${meetingConfig.baseUrl}/users/me/meetings`,
    {
      topic: `MentorMinds Session - ${options.mentorName} & ${options.menteeName}`,
      type: 2, // Scheduled meeting
      start_time: scheduledAt.toISOString(),
      duration: options.durationMinutes,
      agenda: 'Mentorship session meeting',
    },
    {
      headers: {
        Authorization: `Bearer ${meetingConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    meetingUrl: response.data.join_url,
    roomId: response.data.id,
    expiresAt,
    provider: MeetingProvider.ZOOM,
  };
}

/**
 * Create Jitsi room (self-hosted, no API required)
 */
async function createJitsiRoom(
  sessionId: string,
  expiresAt: Date,
  _options: MeetingRoomOptions
): Promise<MeetingRoomResult> {
  const roomName = generateJitsiRoomName(sessionId);
  const meetingUrl = `${meetingConfig.baseUrl}/${roomName}`;

  return {
    meetingUrl,
    roomId: roomName,
    expiresAt,
    provider: MeetingProvider.JITSI,
  };
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    // Retry on network errors or 5xx server errors
    if (!axiosError.response) {
      return true; // Network error
    }
    const status = axiosError.response.status;
    return status >= 500 || status === 429; // Server error or rate limit
  }
  return false;
}

/**
 * Retry meeting room creation once
 */
async function retryCreateMeetingRoom(options: MeetingRoomOptions): Promise<MeetingRoomResult> {
  const { sessionId, scheduledAt, durationMinutes } = options;
  const expiresAt = calculateMeetingExpiry(scheduledAt, durationMinutes);

  switch (meetingConfig.provider) {
    case MeetingProvider.DAILY:
      return await createDailyRoom(sessionId, expiresAt, options);
    case MeetingProvider.WHEREBY:
      return await createWherebyRoom(sessionId, expiresAt, options);
    case MeetingProvider.ZOOM:
      return await createZoomMeeting(sessionId, expiresAt, options);
    case MeetingProvider.JITSI:
      return await createJitsiRoom(sessionId, expiresAt, options);
    default:
      throw new Error(`Unsupported meeting provider: ${meetingConfig.provider}`);
  }
}

/**
 * Meeting Service - Handles video meeting room creation and management
 * Supports multiple providers: Daily.co, Whereby, Zoom, and Jitsi
 */
export const MeetingService = {
  /**
   * Create a meeting room for a session
   */
  async createMeetingRoom(options: MeetingRoomOptions): Promise<MeetingRoomResult> {
    const { sessionId, scheduledAt, durationMinutes } = options;
    
    // Calculate expiry time (30 minutes after session end by default)
    const expiresAt = calculateMeetingExpiry(scheduledAt, durationMinutes);

    try {
      switch (meetingConfig.provider) {
        case MeetingProvider.DAILY:
          return await createDailyRoom(sessionId, expiresAt, options);
        case MeetingProvider.WHEREBY:
          return await createWherebyRoom(sessionId, expiresAt, options);
        case MeetingProvider.ZOOM:
          return await createZoomMeeting(sessionId, expiresAt, options);
        case MeetingProvider.JITSI:
          return await createJitsiRoom(sessionId, expiresAt, options);
        default:
          throw new Error(`Unsupported meeting provider: ${meetingConfig.provider}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Retry logic
      if (isRetryableError(error)) {
        logger.warn(`Meeting provider API failed, retrying... (${errorMessage})`);
        try {
          return await retryCreateMeetingRoom(options);
        } catch (retryError) {
          const retryErrorMessage = retryError instanceof Error ? retryError.message : 'Unknown error';
          logger.error('Meeting room creation failed after retry:', retryErrorMessage);
          throw new Error(
            `Failed to create meeting room after retry. Session ${sessionId} requires manual intervention.`
          );
        }
      }
      throw error;
    }
  },

  /**
   * Validate meeting configuration
   */
  validateConfig(): boolean {
    try {
      return Boolean(meetingConfig?.provider);
    } catch (error) {
      logger.error('Meeting configuration validation failed:', error);
      return false;
    }
  },

  /**
   * Get meeting provider info
   */
  getProviderInfo(): { provider: MeetingProvider; baseUrl: string } {
    return {
      provider: meetingConfig.provider,
      baseUrl: meetingConfig.baseUrl,
    };
  },
};

export default MeetingService;
