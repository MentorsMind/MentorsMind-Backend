/**
 * TranscriptionService
 *
 * Integrates with AWS Transcribe to auto-transcribe completed sessions.
 * Supports speaker identification, full-text search, and PDF/TXT export.
 */

import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
  LanguageCode,
} from '@aws-sdk/client-transcribe';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Client } from '@aws-sdk/client-s3';
import axios from 'axios';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import pool from '../config/database';
import { env } from '../config/env';
import { StorageService } from './storage.service';
import { logger } from '../utils/logger';

const transcribeClient = new TranscribeClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export interface TranscriptSegment {
  speaker: string;
  start_time: number;
  end_time: number;
  text: string;
}

export interface TranscriptRecord {
  id: string;
  booking_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  transcribe_job_name: string | null;
  media_s3_key: string | null;
  transcript_s3_key: string | null;
  full_text: string | null;
  speakers: TranscriptSegment[];
  word_count: number | null;
  pdf_s3_key: string | null;
  txt_s3_key: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export const TranscriptionService = {
  /**
   * Create a pending transcript record for a booking.
   * Called when a session ends and a media file is available.
   */
  async createTranscriptRecord(bookingId: string, mediaS3Key: string): Promise<TranscriptRecord> {
    const { rows } = await pool.query<TranscriptRecord>(
      `INSERT INTO session_transcripts (booking_id, media_s3_key, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (booking_id) DO UPDATE
         SET media_s3_key = EXCLUDED.media_s3_key,
             status = 'pending',
             error_message = NULL,
             updated_at = NOW()
       RETURNING *`,
      [bookingId, mediaS3Key],
    );
    return rows[0];
  },

  /**
   * Start an AWS Transcribe job for a given transcript record.
   * Enables speaker identification (up to 10 speakers).
   */
  async startTranscriptionJob(transcriptId: string): Promise<void> {
    const { rows } = await pool.query<TranscriptRecord>(
      'SELECT * FROM session_transcripts WHERE id = $1',
      [transcriptId],
    );

    const record = rows[0];
    if (!record) throw new Error(`Transcript record ${transcriptId} not found`);
    if (!record.media_s3_key) throw new Error('No media S3 key on transcript record');

    const jobName = `mentorminds-${transcriptId}-${Date.now()}`;
    const mediaUri = `s3://${env.AWS_S3_BUCKET}/${record.media_s3_key}`;

    await transcribeClient.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: LanguageCode.EN_US,
        MediaFormat: 'mp4',
        Media: { MediaFileUri: mediaUri },
        OutputBucketName: env.AWS_S3_BUCKET,
        OutputKey: `transcripts/${transcriptId}/raw.json`,
        Settings: {
          ShowSpeakerLabels: true,
          MaxSpeakerLabels: 10,
        },
      }),
    );

    await pool.query(
      `UPDATE session_transcripts
       SET status = 'processing',
           transcribe_job_name = $1,
           transcript_s3_key = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [jobName, `transcripts/${transcriptId}/raw.json`, transcriptId],
    );

    logger.info('[TranscriptionService] Started AWS Transcribe job', { jobName, transcriptId });
  },

  /**
   * Poll AWS Transcribe for job completion and process the result.
   * Returns true if the job is done (completed or failed), false if still in progress.
   */
  async pollAndProcess(transcriptId: string): Promise<boolean> {
    const { rows } = await pool.query<TranscriptRecord>(
      'SELECT * FROM session_transcripts WHERE id = $1',
      [transcriptId],
    );

    const record = rows[0];
    if (!record?.transcribe_job_name) return false;

    const { TranscriptionJob: job } = await transcribeClient.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: record.transcribe_job_name }),
    );

    if (!job) return false;

    if (job.TranscriptionJobStatus === TranscriptionJobStatus.IN_PROGRESS) {
      return false;
    }

    if (job.TranscriptionJobStatus === TranscriptionJobStatus.FAILED) {
      await pool.query(
        `UPDATE session_transcripts
         SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE id = $2`,
        [job.FailureReason ?? 'AWS Transcribe job failed', transcriptId],
      );
      logger.error('[TranscriptionService] Transcribe job failed', {
        transcriptId,
        reason: job.FailureReason,
      });
      return true;
    }

    if (job.TranscriptionJobStatus === TranscriptionJobStatus.COMPLETED) {
      await this.processCompletedJob(record);
      return true;
    }

    return false;
  },

  /**
   * Download the raw AWS Transcribe JSON output, parse it into segments,
   * generate export files, and persist everything.
   */
  async processCompletedJob(record: TranscriptRecord): Promise<void> {
    if (!record.transcript_s3_key) throw new Error('No transcript S3 key');

    // Download raw transcript JSON from S3
    const signedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: record.transcript_s3_key }),
      { expiresIn: 300 },
    );

    const { data: rawJson } = await axios.get(signedUrl);
    const { segments, fullText } = this.parseTranscribeOutput(rawJson);

    // Generate and upload TXT
    const txtKey = `transcripts/${record.id}/transcript.txt`;
    await StorageService.uploadFile(txtKey, Buffer.from(fullText, 'utf-8'), 'text/plain');

    // Generate and upload PDF
    const pdfKey = `transcripts/${record.id}/transcript.pdf`;
    const pdfBuffer = await this.generatePdf(record.booking_id, segments, fullText);
    await StorageService.uploadFile(pdfKey, pdfBuffer, 'application/pdf');

    await pool.query(
      `UPDATE session_transcripts
       SET status = 'completed',
           full_text = $1,
           speakers = $2,
           word_count = $3,
           txt_s3_key = $4,
           pdf_s3_key = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        fullText,
        JSON.stringify(segments),
        fullText.split(/\s+/).filter(Boolean).length,
        txtKey,
        pdfKey,
        record.id,
      ],
    );

    logger.info('[TranscriptionService] Transcript processed', {
      transcriptId: record.id,
      wordCount: fullText.split(/\s+/).filter(Boolean).length,
      segments: segments.length,
    });
  },

  /**
   * Parse AWS Transcribe JSON output into speaker-labelled segments.
   */
  parseTranscribeOutput(rawJson: any): { segments: TranscriptSegment[]; fullText: string } {
    const results = rawJson?.results;
    if (!results) return { segments: [], fullText: '' };

    const items: any[] = results.items ?? [];
    const speakerSegments: any[] = results.speaker_labels?.segments ?? [];

    // Build a map of start_time -> speaker label
    const speakerMap = new Map<string, string>();
    for (const seg of speakerSegments) {
      for (const item of seg.items ?? []) {
        speakerMap.set(item.start_time, seg.speaker_label);
      }
    }

    const segments: TranscriptSegment[] = [];
    let currentSpeaker = '';
    let currentText = '';
    let segStart = 0;
    let segEnd = 0;

    for (const item of items) {
      if (item.type === 'punctuation') {
        currentText = currentText.trimEnd() + (item.alternatives?.[0]?.content ?? '');
        continue;
      }

      const speaker = speakerMap.get(item.start_time) ?? currentSpeaker;
      const word = item.alternatives?.[0]?.content ?? '';
      const startTime = parseFloat(item.start_time ?? '0');
      const endTime = parseFloat(item.end_time ?? '0');

      if (speaker !== currentSpeaker && currentText.trim()) {
        segments.push({ speaker: currentSpeaker, start_time: segStart, end_time: segEnd, text: currentText.trim() });
        currentText = '';
      }

      if (!currentText) segStart = startTime;
      currentSpeaker = speaker;
      currentText += ` ${word}`;
      segEnd = endTime;
    }

    if (currentText.trim()) {
      segments.push({ speaker: currentSpeaker, start_time: segStart, end_time: segEnd, text: currentText.trim() });
    }

    const fullText = segments.map((s) => `${s.speaker}: ${s.text}`).join('\n\n');
    return { segments, fullText };
  },

  /**
   * Generate a PDF transcript document.
   */
  async generatePdf(bookingId: string, segments: TranscriptSegment[], fullText: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0066cc').text('Session Transcript', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica').fillColor('#666666').text(`Booking ID: ${bookingId}`, { align: 'center' });
      doc.fontSize(10).text(`Generated: ${new Date().toUTCString()}`, { align: 'center' });
      doc.moveDown(1);
      doc.strokeColor('#cccccc').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      if (segments.length === 0) {
        doc.fontSize(12).fillColor('#333333').text(fullText || 'No transcript content available.');
      } else {
        for (const seg of segments) {
          const mins = Math.floor(seg.start_time / 60).toString().padStart(2, '0');
          const secs = Math.floor(seg.start_time % 60).toString().padStart(2, '0');
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#0066cc').text(`${seg.speaker}  [${mins}:${secs}]`);
          doc.fontSize(11).font('Helvetica').fillColor('#222222').text(seg.text, { indent: 10 });
          doc.moveDown(0.8);
        }
      }

      doc.end();
    });
  },

  /**
   * Get a transcript by booking ID.
   */
  async getByBookingId(bookingId: string): Promise<TranscriptRecord | null> {
    const { rows } = await pool.query<TranscriptRecord>(
      'SELECT * FROM session_transcripts WHERE booking_id = $1',
      [bookingId],
    );
    return rows[0] ?? null;
  },

  /**
   * Full-text search across all transcripts accessible to a user.
   * Returns matching bookings with highlighted snippets.
   */
  async search(userId: string, query: string, limit = 20, offset = 0): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
         st.id,
         st.booking_id,
         st.status,
         st.word_count,
         st.created_at,
         ts_headline('english', st.full_text, plainto_tsquery('english', $2),
           'MaxWords=30, MinWords=10, ShortWord=3, HighlightAll=false') AS snippet,
         ts_rank(to_tsvector('english', COALESCE(st.full_text, '')),
           plainto_tsquery('english', $2)) AS rank
       FROM session_transcripts st
       JOIN bookings b ON b.id = st.booking_id
       WHERE (b.mentor_id = $1 OR b.mentee_id = $1)
         AND st.status = 'completed'
         AND to_tsvector('english', COALESCE(st.full_text, '')) @@ plainto_tsquery('english', $2)
       ORDER BY rank DESC
       LIMIT $3 OFFSET $4`,
      [userId, query, limit, offset],
    );
    return rows;
  },

  /**
   * Generate a short-lived presigned download URL for a transcript file.
   */
  async getDownloadUrl(s3Key: string, expiresIn = 3600): Promise<string> {
    return StorageService.generatePresignedUrl(s3Key, expiresIn);
  },
};
