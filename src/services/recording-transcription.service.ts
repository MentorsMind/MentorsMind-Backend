import recordingConfig from '../config/recording.config';
import { logger } from '../utils/logger';
import pool from '../config/database';

interface TranscriptionOptions {
  recordingId: string;
  language?: string;
}

interface TranscriptionResult {
  transcriptionId: string;
  transcript: string;
  language: string;
  confidenceScore: number;
  wordCount: number;
  duration: number;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  speaker?: string;
}

/**
 * Recording Transcription Service - Handles video transcription with multiple providers
 */
class RecordingTranscriptionService {
  private provider: string;
  private enabled: boolean;

  constructor() {
    this.provider = recordingConfig.transcriptionProvider;
    this.enabled = recordingConfig.transcriptionEnabled;
  }

  /**
   * Start transcription for a recording
   */
  async startTranscription(options: TranscriptionOptions): Promise<string> {
    if (!this.enabled) {
      throw new Error('Transcription is not enabled');
    }

    const { recordingId, language = 'en' } = options;

    // Create transcription record
    const query = `
      INSERT INTO recording_transcriptions (recording_id, language, provider, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING id
    `;
    
    const { rows } = await pool.query(query, [recordingId, language, this.provider]);
    const transcriptionId = rows[0].id;

    // Start transcription based on provider
    switch (this.provider) {
      case 'aws':
        await this.transcribeWithAWS(transcriptionId, recordingId, language);
        break;
      case 'google':
        await this.transcribeWithGoogle(transcriptionId, recordingId, language);
        break;
      case 'openai':
        await this.transcribeWithOpenAI(transcriptionId, recordingId, language);
        break;
      default:
        throw new Error(`Unsupported transcription provider: ${this.provider}`);
    }

    return transcriptionId;
  }

  /**
   * Transcribe using AWS Transcribe
   */
  private async transcribeWithAWS(
    transcriptionId: string,
    recordingId: string,
    language: string
  ): Promise<void> {
    try {
      // Update status to processing
      await this.updateTranscriptionStatus(transcriptionId, 'processing');

      // Import AWS SDK dynamically
      const { TranscribeClient, StartTranscriptionJobCommand } = await import('@aws-sdk/client-transcribe');

      // Get recording S3 location
      const recordingQuery = 'SELECT s3_key, s3_bucket FROM session_recordings WHERE id = $1';
      const { rows } = await pool.query(recordingQuery, [recordingId]);
      
      if (rows.length === 0) {
        throw new Error('Recording not found');
      }

      const { s3_key, s3_bucket } = rows[0];
      const mediaFileUri = `s3://${s3_bucket}/${s3_key}`;

      const client = new TranscribeClient({ region: process.env.AWS_TRANSCRIBE_REGION || 'us-east-1' });

      const command = new StartTranscriptionJobCommand({
        TranscriptionJobName: `transcription-${transcriptionId}`,
        Media: { MediaFileUri: mediaFileUri },
        MediaFormat: 'mp4',
        LanguageCode: language,
        Settings: {
          ShowSpeakerLabels: true,
          MaxSpeakerLabels: 2,
        },
      });

      const response = await client.send(command);

      // Store provider job ID
      await pool.query(
        'UPDATE recording_transcriptions SET provider_job_id = $1, started_at = NOW() WHERE id = $2',
        [response.TranscriptionJob?.TranscriptionJobName, transcriptionId]
      );

      logger.info(`Started AWS transcription job: ${response.TranscriptionJob?.TranscriptionJobName}`);
    } catch (error) {
      logger.error('Failed to start AWS transcription:', error);
      await this.updateTranscriptionStatus(transcriptionId, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Transcribe using Google Speech-to-Text
   */
  private async transcribeWithGoogle(
    transcriptionId: string,
    recordingId: string,
    language: string
  ): Promise<void> {
    try {
      await this.updateTranscriptionStatus(transcriptionId, 'processing');

      // Get recording S3 location
      const recordingQuery = 'SELECT s3_key, s3_bucket FROM session_recordings WHERE id = $1';
      const { rows } = await pool.query(recordingQuery, [recordingId]);
      
      if (rows.length === 0) {
        throw new Error('Recording not found');
      }

      const { s3_key, s3_bucket } = rows[0];

      // In a real implementation, you would use Google Cloud Speech-to-Text API
      // For now, we'll create a placeholder
      const jobId = `google-transcription-${transcriptionId}`;
      
      await pool.query(
        'UPDATE recording_transcriptions SET provider_job_id = $1, started_at = NOW() WHERE id = $2',
        [jobId, transcriptionId]
      );

      logger.info(`Started Google transcription job: ${jobId}`);
    } catch (error) {
      logger.error('Failed to start Google transcription:', error);
      await this.updateTranscriptionStatus(transcriptionId, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Transcribe using OpenAI Whisper
   */
  private async transcribeWithOpenAI(
    transcriptionId: string,
    recordingId: string,
    language: string
  ): Promise<void> {
    try {
      await this.updateTranscriptionStatus(transcriptionId, 'processing');

      // Get recording S3 location
      const recordingQuery = 'SELECT s3_key, s3_bucket FROM session_recordings WHERE id = $1';
      const { rows } = await pool.query(recordingQuery, [recordingId]);
      
      if (rows.length === 0) {
        throw new Error('Recording not found');
      }

      const { s3_key, s3_bucket } = rows[0];

      // In a real implementation, you would download the file and use OpenAI Whisper API
      // For now, we'll create a placeholder
      const jobId = `openai-transcription-${transcriptionId}`;
      
      await pool.query(
        'UPDATE recording_transcriptions SET provider_job_id = $1, started_at = NOW() WHERE id = $2',
        [jobId, transcriptionId]
      );

      logger.info(`Started OpenAI transcription job: ${jobId}`);
    } catch (error) {
      logger.error('Failed to start OpenAI transcription:', error);
      await this.updateTranscriptionStatus(transcriptionId, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Update transcription status
   */
  private async updateTranscriptionStatus(
    transcriptionId: string,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    const updates = ['status = $1'];
    const values = [status];
    let idx = 2;

    if (status === 'completed') {
      updates.push(`completed_at = NOW()`);
    }

    if (errorMessage) {
      updates.push(`error_message = $${idx}`);
      values.push(errorMessage);
      idx++;
    }

    values.push(transcriptionId);

    const query = `
      UPDATE recording_transcriptions
      SET ${updates.join(', ')}
      WHERE id = $${idx}
    `;

    await pool.query(query, values);
  }

  /**
   * Complete transcription with results
   */
  async completeTranscription(
    transcriptionId: string,
    transcript: string,
    confidenceScore: number,
    segments?: TranscriptSegment[]
  ): Promise<void> {
    const wordCount = transcript.split(/\s+/).length;
    
    const query = `
      UPDATE recording_transcriptions
      SET 
        transcript = $1,
        confidence_score = $2,
        word_count = $3,
        status = 'completed',
        completed_at = NOW(),
        metadata = $4
      WHERE id = $5
    `;

    await pool.query(query, [
      transcript,
      confidenceScore,
      wordCount,
      JSON.stringify({ segments: segments || [] }),
      transcriptionId,
    ]);

    logger.info(`Completed transcription: ${transcriptionId}`);
  }

  /**
   * Get transcription by ID
   */
  async getTranscription(transcriptionId: string): Promise<any> {
    const query = 'SELECT * FROM recording_transcriptions WHERE id = $1';
    const { rows } = await pool.query(query, [transcriptionId]);
    return rows[0] || null;
  }

  /**
   * Get transcriptions for a recording
   */
  async getTranscriptionsByRecording(recordingId: string): Promise<any[]> {
    const query = `
      SELECT * FROM recording_transcriptions
      WHERE recording_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [recordingId]);
    return rows;
  }

  /**
   * Search transcriptions
   */
  async searchTranscriptions(searchTerm: string, userId: string): Promise<any[]> {
    const query = `
      SELECT t.*, sr.session_id, sr.mentor_id, sr.mentee_id
      FROM recording_transcriptions t
      JOIN session_recordings sr ON t.recording_id = sr.id
      WHERE t.transcript ILIKE $1
        AND (sr.mentor_id = $2 OR sr.mentee_id = $2)
        AND t.status = 'completed'
      ORDER BY t.created_at DESC
      LIMIT 50
    `;
    const { rows } = await pool.query(query, [`%${searchTerm}%`, userId]);
    return rows;
  }

  /**
   * Delete transcription
   */
  async deleteTranscription(transcriptionId: string): Promise<void> {
    const query = 'DELETE FROM recording_transcriptions WHERE id = $1';
    await pool.query(query, [transcriptionId]);
    logger.info(`Deleted transcription: ${transcriptionId}`);
  }
}

export default new RecordingTranscriptionService();
