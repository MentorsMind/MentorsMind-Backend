import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  StorageClass,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env";

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = env.AWS_S3_BUCKET;

export interface S3UploadResult {
  key: string;
  url: string;
}

export const StorageService = {
  /**
   * Upload a file buffer to S3
   */
  async uploadFile(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<S3UploadResult> {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
      ServerSideEncryption: "AES256",
    });

    await s3Client.send(command);

    const url = `s3://${BUCKET}/${key}`;

    return { key, url };
  },

  /**
   * Generate a presigned URL for downloading an S3 object
   */
  async generatePresignedUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  },

  /**
   * Delete an object from S3
   */
  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });

    await s3Client.send(command);
  },

  /**
   * Delete multiple objects from S3 in a single batch request (max 1000 keys)
   */
  async deleteFiles(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const command = new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    });
    await s3Client.send(command);
  },

  /**
   * Upload a file buffer to S3 under Object Lock (WORM) — the object cannot
   * be deleted or overwritten until `retainUntilDate`, even by an account
   * with delete permissions. Requires the bucket to have Object Lock enabled.
   * Used for compliance archives (e.g. audit log archival, issue #772).
   */
  async uploadFileWithRetention(
    key: string,
    body: Buffer,
    contentType: string,
    retainUntilDate: Date,
    metadata?: Record<string, string>,
  ): Promise<S3UploadResult> {
    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
      ServerSideEncryption: "AES256",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: retainUntilDate,
    });

    await s3Client.send(command);

    return { key, url: `s3://${BUCKET}/${key}` };
  },

  /**
   * Build an S3 object key for export files
   */
  buildExportKey(userId: string, jobId: string, timestamp: number): string {
    return `exports/${userId}/${jobId}/export_${userId}_${timestamp}.zip`;
  },

  /**
   * Build an S3 object key for forensics evidence bundles.
   * Layout: forensics/incidents/{incidentId}/{timestamp}.json
   */
  buildForensicsKey(incidentId: string, timestamp: number): string {
    return `forensics/incidents/${incidentId}/${timestamp}.json`;
  },

  /**
   * Build an S3 object key for session recordings
   */
  buildRecordingKey(sessionId: string, recordingId: string, extension: string = 'mp4'): string {
    return `recordings/${sessionId}/${recordingId}.${extension}`;
  },

  /**
   * Generate a presigned URL for video playback
   */
  async generatePlaybackUrl(
    key: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentType: 'video/mp4',
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  },

  /**
   * Transition an S3 object to a different storage class in-place using a server-side copy.
   * Supported targets: STANDARD_IA, GLACIER, DEEP_ARCHIVE.
   */
  async transitionStorageClass(
    key: string,
    storageClass: 'STANDARD_IA' | 'GLACIER' | 'DEEP_ARCHIVE',
  ): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: BUCKET,
      Key: key,
      CopySource: `${BUCKET}/${key}`,
      StorageClass: storageClass as StorageClass,
      MetadataDirective: 'COPY',
    });

    await s3Client.send(command);
  },

  /**
   * Retrieve the current storage class of an S3 object via a HEAD request.
   * Returns undefined if the object does not exist or storage class is not set.
   */
  async getObjectStorageClass(key: string): Promise<string | undefined> {
    const command = new HeadObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });

    const response = await s3Client.send(command);
    return response.StorageClass;
  },

  /**
   * Apply S3 bucket lifecycle rules for the recordings/ prefix:
   *  - Transition to STANDARD_IA after 30 days
   *  - Transition to GLACIER after 90 days
   *  - Expire (delete) objects after RECORDING_RETENTION_DAYS (default 365)
   */
  async applyLifecycleRules(bucket: string): Promise<void> {
    const retentionDays = parseInt(env.RECORDING_RETENTION_DAYS ?? '365', 10);

    const command = new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'recordings-storage-tiering',
            Status: 'Enabled',
            Filter: {
              Prefix: 'recordings/',
            },
            Transitions: [
              {
                Days: 30,
                StorageClass: 'STANDARD_IA' as StorageClass,
              },
              {
                Days: 90,
                StorageClass: 'GLACIER' as StorageClass,
              },
            ],
            Expiration: {
              Days: retentionDays,
            },
          },
        ],
      },
    });

    await s3Client.send(command);
  },
};
