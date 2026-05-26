import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
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
   * Build an S3 object key for export files
   */
  buildExportKey(userId: string, jobId: string, timestamp: number): string {
    return `exports/${userId}/${jobId}/export_${userId}_${timestamp}.zip`;
  },
};
