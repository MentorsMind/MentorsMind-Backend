import dotenv from 'dotenv';

dotenv.config();

export enum MeetingProvider {
  DAILY = 'daily',
  WHEREBY = 'whereby',
  ZOOM = 'zoom',
  JITSI = 'jitsi',
}

export interface MeetingConfig {
  provider: MeetingProvider;
  apiKey: string;
  apiSecret?: string;
  baseUrl: string;
  roomExpiryMinutes: number;
  retryAttempts: number;
}

const getProviderBaseUrl = (provider: MeetingProvider): string => {
  switch (provider) {
    case MeetingProvider.DAILY:
      return 'https://api.daily.co/v1';
    case MeetingProvider.WHEREBY:
      return 'https://api.whereby.dev/v1';
    case MeetingProvider.ZOOM:
      return 'https://api.zoom.us/v2';
    case MeetingProvider.JITSI:
      return process.env.JITSI_BASE_URL || 'https://meet.jit.si';
    default:
      throw new Error(`Unknown meeting provider: ${provider}`);
  }
};

const validateMeetingConfig = (): MeetingConfig => {
  const defaultProvider =
    process.env.NODE_ENV === 'test' ? MeetingProvider.JITSI : MeetingProvider.DAILY;
  const provider = (
    process.env.MEETING_PROVIDER || defaultProvider
  ).toLowerCase() as MeetingProvider;
  const apiKey = process.env.MEETING_API_KEY || '';
  const apiSecret = process.env.MEETING_API_SECRET;
  const roomExpiryMinutes = parseInt(process.env.MEETING_ROOM_EXPIRY_MINUTES || '30', 10);
  const retryAttempts = parseInt(process.env.MEETING_RETRY_ATTEMPTS || '1', 10);

  // Validate required configuration
  if (!Object.values(MeetingProvider).includes(provider)) {
    throw new Error(
      `Invalid MEETING_PROVIDER: ${provider}. Must be one of: ${Object.values(MeetingProvider).join(', ')}`
    );
  }

  // API key is required for all providers except Jitsi
  if (provider !== MeetingProvider.JITSI && !apiKey) {
    throw new Error(
      `MEETING_API_KEY is required for ${provider} provider. Please set it in your .env file.`
    );
  }

  return {
    provider,
    apiKey,
    apiSecret,
    baseUrl: getProviderBaseUrl(provider),
    roomExpiryMinutes,
    retryAttempts,
  };
};

export const meetingConfig: MeetingConfig = validateMeetingConfig();

export default meetingConfig;
