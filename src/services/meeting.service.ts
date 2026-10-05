import axios, { AxiosError } from 'axios';
import jwt from 'jsonwebtoken';
import meetingConfig, { MeetingProvider } from '../config/meeting.config';
import { calculateMeetingExpiry, generateJitsiRoomName } from '../utils/meeting.utils';
import { Logger } from "../utils/logger.utils";

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

/**
 * Result of a token generation request.
 *
 * When the provider requires a token, `token` holds the signed credential
 * string and `tokenExpiry` is the UTC timestamp (seconds) at which it expires.
 *
 * When the provider does not use tokens, `token` is `null` and `reason`
 * explains why (currently always `'not_required'`).
 */
export interface GenerateTokenResult {
  token: string | null;
  tokenExpiry: number | null;
  reason?: string;
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

interface WherebyHostTokenResponse {
  token: string;
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
 * Generate Daily.co participant token
 */
async function generateDailyToken(
  roomName: string,
  participantName: string
): Promise<GenerateTokenResult> {
  const apiKey = meetingConfig.apiKey;
  
  if (!apiKey) {
    throw new Error('Daily.co API key is not configured. Set MEETING_API_KEY.');
  }

  // Token valid for 2 hours by default
  const tokenExpiry = Math.floor(Date.now() / 1000) + 2 * 60 * 60;

  try {
    const response = await axios.post(
      `${meetingConfig.baseUrl}/meeting-tokens`,
      {
        properties: {
          room_name: roomName,
          user_name: participantName,
          is_owner: false,
          exp: tokenExpiry,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const token = response.data?.token;
    
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error('Daily.co API returned empty or invalid token');
    }

    logger.info(`Generated Daily.co token for ${participantName} in room ${roomName}`);
    
    return {
      token: token.trim(),
      tokenExpiry,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.info || error.message;
      throw new Error(`Daily.co token generation failed (${status}): ${message}`);
    }
    throw error;
  }
}

/**
 * Generate Zoom Video SDK JWT token.
 *
 * The Zoom Video SDK requires a short-lived JWT with the following claims:
 *   app_key      — Zoom Video SDK key (ZOOM_SDK_KEY)
 *   tpc          — topic / room name
 *   role_type    — 0 = participant, 1 = host
 *   user_identity — display name of the participant
 *   nb           — not-before (now)
 *   exp          — expiry (now + TTL)
 *
 * Reference: https://developers.zoom.us/docs/video-sdk/auth/
 */
function generateZoomToken(
  roomId: string,
  participantName: string,
  roleType: 0 | 1 = 0
): GenerateTokenResult {
  const sdkKey = meetingConfig.zoomSdkKey;
  const sdkSecret = meetingConfig.zoomSdkSecret;

  if (!sdkKey || !sdkSecret) {
    throw new Error(
      'Zoom Video SDK credentials are not configured. Set ZOOM_SDK_KEY and ZOOM_SDK_SECRET.'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = 2 * 60 * 60; // 2 hours
  const exp = now + ttl;

  const payload = {
    app_key: sdkKey,
    tpc: roomId,
    role_type: roleType,
    user_identity: participantName,
    nb: now,
    exp,
  };

  const token = jwt.sign(payload, sdkSecret, { algorithm: 'HS256' });

  return { token, tokenExpiry: exp };
}

/**
 * Generate a Whereby host token via the Whereby REST API.
 *
 * The Whereby REST API issues short-lived host tokens that grant host
 * privileges inside a specific room. The token is valid for the duration
 * of the meeting plus a configurable buffer.
 *
 * Reference: https://docs.whereby.com/reference/whereby-rest-api-reference#meetings-roomname-host
 */
async function generateWherebyHostToken(
  roomName: string
): Promise<GenerateTokenResult> {
  const apiKey = meetingConfig.wherebyApiKey || meetingConfig.apiKey;

  if (!apiKey) {
    throw new Error(
      'Whereby API key is not configured. Set WHEREBY_API_KEY (or MEETING_API_KEY).'
    );
  }

  // TTL matches room expiry setting
  const ttlMinutes = meetingConfig.roomExpiryMinutes || 30;
  const expiryDate = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const response = await axios.post<WherebyHostTokenResponse>(
    `${meetingConfig.baseUrl}/meetings/${encodeURIComponent(roomName)}/host`,
    { endDate: expiryDate.toISOString() },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const tokenExpiry = Math.floor(expiryDate.getTime() / 1000);
  return { token: response.data.token, tokenExpiry };
}

/**
 * Generate a Jitsi JWT token.
 *
 * When JITSI_JWT_SECRET is set, Jitsi can be configured to require JWT
 * authentication. The JWT carries the room, user identity, and optional
 * moderator flag as claims.
 *
 * If JITSI_JWT_SECRET is not configured, Jitsi operates in open (no-auth)
 * mode and no token is needed — this returns { token: null, reason: 'not_required' }.
 *
 * Reference: https://github.com/jitsi/lib-jitsi-meet/blob/master/doc/tokens.md
 */
function generateJitsiToken(
  roomId: string,
  participantName: string,
  isModerator: boolean = false
): GenerateTokenResult {
  const jwtSecret = meetingConfig.jitsiJwtSecret;

  if (!jwtSecret) {
    // No secret configured — Jitsi is in open/anonymous mode
    return { token: null, tokenExpiry: null, reason: 'not_required' };
  }

  const appId = meetingConfig.jitsiAppId || 'mentorminds';
  const now = Math.floor(Date.now() / 1000);
  const ttl = 2 * 60 * 60; // 2 hours
  const exp = now + ttl;

  const payload = {
    iss: appId,
    sub: appId,
    aud: appId,
    iat: now,
    exp,
    room: roomId,
    context: {
      user: {
        name: participantName,
        moderator: isModerator,
      },
    },
  };

  const token = jwt.sign(payload, jwtSecret, { algorithm: 'HS256' });
  return { token, tokenExpiry: exp };
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

  /**
   * Generate a participant token for provider-specific SDK authentication.
   *
   * Returns a `GenerateTokenResult` with:
   *   - `token`       — signed credential string, or `null` if not needed
   *   - `tokenExpiry` — Unix timestamp (seconds) when the token expires, or `null`
   *   - `reason`      — present when `token` is `null` (e.g. `'not_required'`)
   *
   * Providers:
   *   - Daily.co  → API-issued meeting token (HTTP call to /meeting-tokens)
   *   - Zoom      → Video SDK JWT signed with ZOOM_SDK_KEY / ZOOM_SDK_SECRET
   *   - Whereby   → API-issued host token  (HTTP call to /meetings/:room/host)
   *   - Jitsi     → JWT signed with JITSI_JWT_SECRET (or null if unconfigured)
   */
  async generateToken(roomId: string, participantName: string): Promise<GenerateTokenResult> {
    switch (meetingConfig.provider) {
      case MeetingProvider.DAILY:
        return await generateDailyToken(roomId, participantName);

      case MeetingProvider.ZOOM:
        return generateZoomToken(roomId, participantName);

      case MeetingProvider.WHEREBY:
        return await generateWherebyHostToken(roomId);

      case MeetingProvider.JITSI:
        return generateJitsiToken(roomId, participantName);

      default:
        throw new Error(`Token generation not supported for provider: ${meetingConfig.provider}`);
    }
  },
};

export default MeetingService;
