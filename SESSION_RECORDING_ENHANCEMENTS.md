# Session Recording & Playback Enhancements

## Overview
This document describes the enhancements made to the session recording system, adding support for AWS IVS/Agora integration, video transcription, and bookmarks/annotations.

## New Features

### 1. Video Recording Provider Integration
Added support for multiple video recording providers:

- **AWS IVS**: Amazon Interactive Video Service for live streaming and recording
- **Agora**: Real-time communication platform with recording capabilities
- **Manual**: Client-side upload (existing functionality)

Configuration in `.env`:
```env
RECORDING_PROVIDER=manual  # ivs | agora | manual
AWS_IVS_CHANNEL_ARN=
AWS_IVS_REGION=us-east-1
AGORA_APP_ID=
AGORA_APP_CERTIFICATE=
RECORDING_RETENTION_DAYS=90
```

### 2. Video Transcription
Automatic transcription of recorded sessions with multi-provider support:

- **AWS Transcribe**: Amazon's speech-to-text service
- **Google Speech-to-Text**: Google Cloud Speech API
- **OpenAI Whisper**: OpenAI's transcription model

Configuration in `.env`:
```env
RECORDING_TRANSCRIPTION_ENABLED=false
TRANSCRIPTION_PROVIDER=aws
```

Features:
- Speaker identification
- Full-text search across transcriptions
- Confidence scoring
- Word count and duration tracking
- Automatic transcription on recording completion (if enabled and consented)

### 3. Bookmarks and Annotations
Ability to mark specific timestamps in recordings:

- **Bookmarks**: Quick navigation points
- **Annotations**: Notes attached to specific timestamps
- **Highlights**: Color-coded segments of the recording

Features:
- Timestamp-based markers
- Private and public bookmarks
- Color-coded highlights
- Note attachments
- Export bookmarks
- Search within recordings

## Database Changes

### New Tables

#### `recording_transcriptions`
Stores video transcriptions with multi-provider support:
- Links to session_recordings
- Full transcript text
- Language and confidence score
- Provider job tracking
- Processing status

#### `recording_bookmarks`
Stores bookmarks and annotations:
- Links to session_recordings and users
- Type (bookmark, annotation, highlight)
- Timestamp in seconds
- Title, notes, color
- Privacy settings

## API Endpoints

### Transcription Endpoints

#### Start Transcription
```
POST /api/v1/recordings/:recordingId/transcription
```

Body:
```json
{
  "language": "en"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "transcriptionId": "uuid"
  }
}
```

#### Get Transcription
```
GET /api/v1/recordings/:recordingId/transcription
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "transcript": "Full text...",
      "language": "en",
      "confidenceScore": 0.95,
      "status": "completed"
    }
  ]
}
```

#### Search Transcriptions
```
GET /api/v1/transcriptions/search?query=search_term
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "transcript": "...",
      "session_id": "uuid"
    }
  ]
}
```

### Bookmark Endpoints

#### Create Bookmark
```
POST /api/v1/recordings/:recordingId/bookmarks
```

Body:
```json
{
  "type": "bookmark",
  "timestampSeconds": 120.5,
  "title": "Important point",
  "note": "Discussion about X",
  "color": "#ff0000",
  "isPrivate": true
}
```

#### Get Bookmarks for Recording
```
GET /api/v1/recordings/:recordingId/bookmarks
```

#### Get User's Bookmarks
```
GET /api/v1/bookmarks
```

#### Update Bookmark
```
PUT /api/v1/bookmarks/:bookmarkId
```

Body:
```json
{
  "title": "Updated title",
  "note": "Updated note"
}
```

#### Delete Bookmark
```
DELETE /api/v1/bookmarks/:bookmarkId
```

#### Export Bookmarks
```
GET /api/v1/recordings/:recordingId/bookmarks/export
```

Response:
```json
{
  "success": true,
  "data": {
    "recordingId": "uuid",
    "exportDate": "2026-05-29T10:00:00Z",
    "bookmarks": [...]
  }
}
```

## Service Integration

### Video Recording Service (`video-recording.service.ts`)
Handles provider-specific recording operations:
- Start/stop recording based on provider
- Stream URL generation
- Recording status tracking

### Recording Transcription Service (`recording-transcription.service.ts`)
Manages transcription workflow:
- Multi-provider support (AWS, Google, OpenAI)
- Job status tracking
- Transcript storage and retrieval
- Full-text search

### Recording Bookmark Service (`recording-bookmark.service.ts`)
Manages bookmarks and annotations:
- CRUD operations for bookmarks
- Privacy controls
- Export functionality
- Timestamp-based queries

## Enhanced Recording Service

The existing `session-recording.service.ts` has been enhanced to:
- Integrate with video recording providers
- Automatically start transcription when recording completes (if enabled)
- Support configurable retention periods
- Store provider-specific metadata

## Privacy and Consent

### Recording Consent
Existing consent system enhanced:
- Both mentor and mentee must consent
- Consent tracked with IP and user agent
- Automatic transcription only starts with full consent

### Bookmark Privacy
- Bookmarks can be private (default) or public
- Private bookmarks only visible to creator
- Public bookmarks visible to all recording participants

## Configuration

### Environment Variables

```env
# Recording Provider
RECORDING_PROVIDER=manual  # ivs | agora | manual

# AWS IVS
AWS_IVS_CHANNEL_ARN=
AWS_IVS_REGION=us-east-1

# Agora
AGORA_APP_ID=
AGORA_APP_CERTIFICATE=

# Recording Settings
RECORDING_RETENTION_DAYS=90

# Transcription
RECORDING_TRANSCRIPTION_ENABLED=false
TRANSCRIPTION_PROVIDER=aws  # aws | google | openai
```

### Recording Config (`recording.config.ts`)
Centralized configuration for:
- Provider selection
- Quality settings (low, medium, high)
- Format support
- Transcription settings

## Migration Guide

### Running Migrations
```bash
npm run migrate:up
```

This will create:
- `recording_transcriptions` table
- `recording_bookmarks` table

### Updating Existing Code
No breaking changes to existing recording functionality. New features are opt-in via configuration.

## Testing

### Unit Tests
Test coverage for:
- Video recording service (provider-specific logic)
- Transcription service (multi-provider)
- Bookmark service (CRUD operations)
- Controller endpoints

### Integration Tests
Test scenarios:
- Recording lifecycle with IVS/Agora
- Transcription workflow
- Bookmark creation and retrieval
- Privacy controls

## Performance Considerations

### Transcription
- Asynchronous processing via job queues
- Status polling for job completion
- Efficient full-text search using PostgreSQL tsvector

### Bookmarks
- Indexed queries on timestamp
- Efficient user-based filtering
- Export generation on-demand

## Security

### Access Control
- All endpoints require authentication
- Recording access limited to mentor/mentee
- Transcription access follows recording permissions
- Bookmark privacy respected in queries

### Data Protection
- Sensitive keys marked in env validation
- Presigned URLs with expiration
- Automatic deletion after retention period

## Troubleshooting

### Recording Not Starting
- Check provider configuration
- Verify credentials (AWS IVS, Agora)
- Check provider service status

### Transcription Failing
- Verify transcription provider credentials
- Check recording file is accessible
- Review transcription job status

### Bookmark Issues
- Verify user has access to recording
- Check timestamp is within recording duration
- Review privacy settings

## Future Enhancements

1. **Real-time Transcription**: Live transcription during sessions
2. **Video Highlights**: AI-generated highlight reels
3. **Smart Bookmarks**: AI-suggested important moments
4. **Collaborative Annotations**: Shared notes between participants
5. **Transcription Editing**: Manual correction of transcripts
6. **Multi-language Support**: Transcription in multiple languages
7. **Speaker Diarization**: Improved speaker identification
8. **Search Within Video**: Jump to video position from transcript search

## Dependencies

### New Dependencies
- `@aws-sdk/client-transcribe` (optional, for AWS Transcribe)
- `@aws-sdk/client-ivs` (optional, for AWS IVS)
- Agora SDK (optional, for Agora integration)

### Existing Dependencies
- AWS SDK (already present for S3)
- PostgreSQL (for transcription search)
- Existing recording infrastructure

## Deployment

### Docker Compose
Add environment variables to `.env`:
```env
RECORDING_PROVIDER=manual
RECORDING_TRANSCRIPTION_ENABLED=false
```

### Production Considerations
- Use provider-specific credentials from secrets manager
- Configure appropriate retention periods
- Enable transcription based on regulatory requirements
- Monitor transcription job queues
- Set up alerts for failed transcriptions
