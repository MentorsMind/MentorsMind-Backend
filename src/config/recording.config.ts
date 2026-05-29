import { env } from './env';

const recordingConfig = {
  provider: env.RECORDING_PROVIDER,
  
  // AWS IVS Configuration
  ivs: {
    channelArn: env.AWS_IVS_CHANNEL_ARN,
    region: env.AWS_IVS_REGION,
  },
  
  // Agora Configuration
  agora: {
    appId: env.AGORA_APP_ID,
    appCertificate: env.AGORA_APP_CERTIFICATE,
  },
  
  // Recording settings
  retentionDays: parseInt(env.RECORDING_RETENTION_DAYS, 10),
  transcriptionEnabled: env.RECORDING_TRANSCRIPTION_ENABLED === 'true',
  transcriptionProvider: env.TRANSCRIPTION_PROVIDER,
  
  // Recording formats
  formats: {
    video: ['mp4', 'webm'],
    audio: ['mp3', 'aac', 'wav'],
  },
  
  // Quality settings
  quality: {
    low: { bitrate: 500, resolution: '480p' },
    medium: { bitrate: 1000, resolution: '720p' },
    high: { bitrate: 2500, resolution: '1080p' },
  },
} as const;

export default recordingConfig;
export type RecordingConfig = typeof recordingConfig;
