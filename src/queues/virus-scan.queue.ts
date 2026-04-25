import { Queue, Worker, Job } from 'bullmq';
import config from '../config';
import { logger } from '../utils/logger';
import pool from '../config/database';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { SocketService } from '../services/socket.service';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const redisUrl = config.redis.url || 'redis://localhost:6379';
const url = new URL(redisUrl);

const connection = {
  host: url.hostname,
  port: parseInt(url.port, 10) || 6379,
  password: url.password || undefined,
};

export const virusScanQueue = new Queue('virus-scan-queue', { connection });

export const virusScanWorker = new Worker(
  'virus-scan-queue',
  async (job: Job) => {
    const { attachmentId, storageKey, bucket } = job.data;
    
    try {
      // Download file from S3 for scanning
      const getCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      });
      
      const response = await s3.send(getCommand);
      const chunks: Uint8Array[] = [];
      
      // @ts-ignore - response.Body is a readable stream
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      
      const fileBuffer = Buffer.concat(chunks);
      
      // Scan file with ClamAV
      const scanResult = await scanWithClamAV(fileBuffer);
      
      // Update attachment record with scan result
      const { rows } = await pool.query(
        `UPDATE message_attachments
         SET scan_status = $1, scanned_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [scanResult, attachmentId]
      );
      
      const attachment = rows[0];
      
      logger.info('[VirusScanQueue] Scan completed', {
        attachmentId,
        scanResult,
        fileSize: fileBuffer.length,
      });
      
      // Notify uploader via WebSocket
      let signedUrl: string | undefined;
      if (scanResult === 'clean') {
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: storageKey,
        });
        signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      }
      
      SocketService.emitToUser(attachment.uploader_id, 'attachment:scan_complete', {
        attachmentId: attachment.id,
        scanStatus: scanResult,
        signedUrl,
        file_name: attachment.file_name,
      });
      
      // If infected, delete the file from S3
      if (scanResult === 'infected') {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
          logger.warn('[VirusScanQueue] Deleted infected file from S3', { storageKey });
        } catch (err) {
          logger.error('[VirusScanQueue] Failed to delete infected file', { err });
        }
      }
      
      return { attachmentId, scanResult };
    } catch (error) {
      logger.error('[VirusScanQueue] Scan failed', {
        attachmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Mark as error if scan fails
      await pool.query(
        `UPDATE message_attachments
         SET scan_status = 'error', scanned_at = NOW()
         WHERE id = $1`,
        [attachmentId]
      );
      
      throw error;
    }
  },
  { connection, concurrency: 3 },
);

virusScanWorker.on('completed', (job) => {
  logger.info(`Virus scan job ${job.id} completed`);
});

virusScanWorker.on('failed', (job, err) => {
  logger.error(`Virus scan job ${job?.id} failed`, { error: err.message });
});

/**
 * Scan a file buffer using ClamAV via clamdscan or clamscan
 */
async function scanWithClamAV(fileBuffer: Buffer): Promise<'clean' | 'infected' | 'error'> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  
  try {
    // Create a temporary file for scanning
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `scan_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    
    fs.writeFileSync(tempFilePath, fileBuffer);
    
    // Try clamdscan first (faster, uses daemon), fallback to clamscan
    let scanResult;
    try {
      scanResult = await execAsync(`clamdscan --no-summary ${tempFilePath}`);
    } catch (clamdError) {
      // clamdscan not available, try clamscan
      try {
        scanResult = await execAsync(`clamscan --no-summary ${tempFilePath}`);
      } catch (clamscanError) {
        // Neither available, log error and return error status
        logger.error('[VirusScanQueue] Neither clamdscan nor clamscan available');
        fs.unlinkSync(tempFilePath);
        return 'error';
      }
    }
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
    
    // Parse output - ClamAV returns "OK" for clean, or virus name for infected
    const stdout = scanResult.stdout || '';
    const stderr = scanResult.stderr || '';
    const output = stdout + stderr;
    
    if (output.includes('OK') && !output.includes('FOUND')) {
      return 'clean';
    } else if (output.includes('FOUND') || output.includes('Infected')) {
      return 'infected';
    } else {
      logger.warn('[VirusScanQueue] Unknown scan result', { output });
      return 'error';
    }
  } catch (error) {
    logger.error('[VirusScanQueue] Scan execution failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 'error';
  }
}
