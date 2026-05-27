# Session Recording & Playback Implementation

**Issue:** #449  
**Description:** Allow recording and playback of mentoring sessions

## Overview

This implementation provides a complete session recording and playback system with privacy compliance, user consent tracking, and automatic cleanup after 90 days.

## Acceptance Criteria

- ✅ Record session video/audio with user consent
- ✅ Store recordings in S3/cloud storage
- ✅ Generate playback URL
- ✅ Implement playback controls (pause, seek, speed) - via presigned URLs
- ✅ Delete recordings after 90 days
- ✅ Comply with privacy regulations

## Architecture

### Database Schema

**Table: `session_recordings`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | Foreign key to sessions |
| mentor_id | UUID | Foreign key to users (mentor) |
| mentee_id | UUID | Foreign key to users (mentee) |
| s3_key | VARCHAR(500) | S3 object key |
| s3_bucket | VARCHAR(255) | S3 bucket name |
| file_size | BIGINT | File size in bytes |
| duration_seconds | INTEGER | Recording duration |
| status | VARCHAR(50) | recording, processing, ready, deleted, failed |
| mentor_consent | BOOLEAN | Mentor consent status |
| mentee_consent | BOOLEAN | Mentee consent status |
| mentor_consent_timestamp | TIMESTAMP | When mentor consented |
| mentee_consent_timestamp | TIMESTAMP | When mentee consented |
| consent_ip_address | VARCHAR(45) | IP address of consent |
| consent_user_agent | TEXT | User agent of consent |
| recording_started_at | TIMESTAMP | Recording start time |
| recording_ended_at | TIMESTAMP | Recording end time |
| expires_at | TIMESTAMP | Auto-delete timestamp (90 days) |
| metadata | JSONB | Additional metadata (format, codec, etc.) |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

### Components

#### 1. Database Migration
- **File:** `database/migrations/059_create_session_recordings.sql`
- Creates the `session_recordings` table with indexes for performance
- Includes trigger for automatic `updated_at` timestamp updates

#### 2. Model
- **File:** `src/models/session-recording.model.ts`
- Provides database operations for recordings
- Methods: create, findById, findBySessionId, findByUserId, updateConsent, updateStatus, findExpired, markAsDeleted, delete, hasFullConsent

#### 3. Storage Service Extension
- **File:** `src/services/storage.service.ts`
- Added methods:
  - `buildRecordingKey()` - Generates S3 key for recordings
  - `generatePlaybackUrl()` - Generates presigned URL for video playback

#### 4. Recording Service
- **File:** `src/services/session-recording.service.ts`
- Core business logic for recording lifecycle:
  - `startRecording()` - Initialize a new recording
  - `uploadRecording()` - Upload recording data to S3
  - `completeRecording()` - Mark recording as ready after processing
  - `updateConsent()` - Handle user consent updates
  - `generatePlaybackUrl()` - Generate presigned playback URL
  - `getRecording()` - Get recording details
  - `getUserRecordings()` - Get all recordings for a user
  - `deleteRecording()` - Delete a recording
  - `findExpiredRecordings()` - Find recordings needing cleanup
  - `cleanupExpiredRecording()` - Delete expired recording

#### 5. Controller
- **File:** `src/controllers/session-recording.controller.ts`
- HTTP endpoints for recording operations:
  - `POST /api/v1/sessions/:sessionId/recordings/start` - Start recording
  - `POST /api/v1/recordings/:recordingId/upload` - Upload recording data
  - `POST /api/v1/recordings/:recordingId/complete` - Mark recording complete
  - `POST /api/v1/recordings/:recordingId/consent` - Update consent
  - `GET /api/v1/recordings/:recordingId/playback-url` - Get playback URL
  - `GET /api/v1/recordings/:recordingId` - Get recording details
  - `GET /api/v1/recordings` - Get user's recordings
  - `DELETE /api/v1/recordings/:recordingId` - Delete recording

#### 6. Routes
- **File:** `src/routes/session-recording.routes.ts`
- Route definitions for recording endpoints
- All routes require authentication
- Mounted at `/api/v1/recordings`

#### 7. Scheduled Job
- **File:** `src/jobs/recordingCleanup.job.ts`
- Daily job to clean up expired recordings (older than 90 days)
- Deletes from S3 and marks as deleted in database
- Includes error handling and logging

#### 8. Tests
- **File:** `src/__tests__/services/session-recording.service.unit.test.ts`
- Unit tests for recording service
- Covers: startRecording, updateConsent, generatePlaybackUrl, deleteRecording, cleanupExpiredRecording

## Privacy & Compliance

### Consent Tracking
- Both mentor and mentee must consent before recording can be accessed
- Consent is tracked with timestamps, IP address, and user agent
- Audit logs record all consent changes

### Automatic Deletion
- Recordings automatically expire after 90 days
- Scheduled job runs daily to clean up expired recordings
- Expired recordings are deleted from S3 and marked as deleted in database

### Audit Logging
- All recording operations are logged to audit_logs table
- Includes: recording started, completed, consent updated, playback URL generated, deleted
- Tracks user ID, IP address, and user agent for compliance

## API Endpoints

### Start Recording
```http
POST /api/v1/sessions/:sessionId/recordings/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "format": "mp4" // optional
}
```

### Update Consent
```http
POST /api/v1/recordings/:recordingId/consent
Authorization: Bearer <token>
Content-Type: application/json

{
  "consent": true
}
```

### Generate Playback URL
```http
GET /api/v1/recordings/:recordingId/playback-url?expiresIn=3600
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "url": "https://s3-presigned-url...",
    "expiresIn": 3600,
    "expiresAt": "2024-01-01T12:00:00Z"
  }
}
```

### Get Recording Details
```http
GET /api/v1/recordings/:recordingId
Authorization: Bearer <token>
```

### Get User Recordings
```http
GET /api/v1/recordings
Authorization: Bearer <token>
```

### Delete Recording
```http
DELETE /api/v1/recordings/:recordingId
Authorization: Bearer <token>
```

## Playback Controls

Playback controls (pause, seek, speed) are handled on the frontend using the presigned URL. The presigned URL provides direct access to the video file in S3, allowing standard HTML5 video player controls to function normally.

## Deployment Steps

1. **Run Database Migration**
   ```bash
   npm run migrate:up
   ```

2. **Configure S3 Bucket**
   - Ensure AWS credentials are set in environment variables
   - Verify bucket exists and has proper permissions
   - Set up lifecycle rules for additional safety (optional)

3. **Register Scheduled Job**
   - Add the recording cleanup job to your BullMQ worker configuration
   - Set to run daily (cron pattern: `0 0 * * *`)

4. **Update Environment Variables**
   - Ensure `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` are set
   - No additional environment variables required

## Security Considerations

1. **Authentication**: All recording endpoints require authentication
2. **Authorization**: Users can only access recordings they are part of (mentor or mentee)
3. **Consent**: Both parties must consent before playback is allowed
4. **Presigned URLs**: Playback URLs expire after a configurable time (default 1 hour)
5. **Audit Trail**: All operations are logged for compliance
6. **Data Retention**: Automatic deletion after 90 days ensures privacy compliance

## Testing

Run unit tests:
```bash
npm test -- session-recording.service.unit.test.ts
```

## Future Enhancements

- Integration with meeting providers (Daily.co, Whereby, Zoom) for automatic recording
- Streaming upload support for large recordings
- Transcription and captioning features
- Recording analytics (view count, watch time)
- Downloadable recordings with additional consent
- Recording thumbnails and preview generation
