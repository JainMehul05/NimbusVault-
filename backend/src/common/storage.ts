import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Transform } from 'stream';
import type { Readable } from 'stream';
import { createHash } from 'crypto';
import { config } from '@config/index';
import { createChildLogger } from '@common/logger';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface UploadResult {
  key: string;
  size: number;
  checksumSha256: string;
}

export interface FileMetadata {
  size: number;
  contentType: string;
  lastModified: Date;
  checksumSha256?: string;
}

export interface PresignedUrlResult {
  url: string;
  expiresIn: number;
}

export class StorageService {
  private client: S3Client | null = null;
  private config: StorageConfig | null = null;
  private initialized = false;
  private readonly log = createChildLogger({ module: 'storage' });

  initialize(): void {
    if (this.initialized) return;

    const { region, accessKeyId, secretAccessKey, s3Bucket } = config.aws;

    if (!region || !accessKeyId || !secretAccessKey || !s3Bucket) {
      this.log.warn('S3 configuration incomplete; storage operations will fail until configured');
      return;
    }

    const endpoint = process.env.S3_ENDPOINT || `https://s3.${region}.amazonaws.com`;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

    this.config = {
      endpoint,
      region,
      bucket: s3Bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle,
    };

    this.client = new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: this.config.forcePathStyle,
      // Disable checksums for LocalStack compatibility
      // LocalStack doesn't support x-amz-checksum-* headers in presigned URLs
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    this.initialized = true;
    this.log.info({ endpoint: this.config.endpoint, bucket: this.config.bucket }, 'Storage service initialized');
  }

  private ensureClient(): S3Client {
    if (!this.client || !this.config) {
      this.log.error('Storage service not initialized - missing S3 configuration');
      throw AppError.serviceUnavailable('Object storage not configured', ErrorCodes.SERVICE_UNAVAILABLE);
    }
    return this.client;
  }

  private getBucket(): string {
    if (!this.config) {
      throw AppError.serviceUnavailable('Object storage not configured', ErrorCodes.SERVICE_UNAVAILABLE);
    }
    return this.config.bucket;
  }

  generateObjectKey(userId: string, originalFilename: string): string {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const extension = originalFilename.includes('.')
      ? originalFilename.substring(originalFilename.lastIndexOf('.'))
      : '';
    return `${userId}/${timestamp}-${randomSuffix}${extension}`;
  }

  async upload(
    userId: string,
    originalFilename: string,
    stream: Readable,
    contentType: string
  ): Promise<UploadResult> {
    const client = this.ensureClient();
    const bucket = this.getBucket();
    const key = this.generateObjectKey(userId, originalFilename);

    const hash = createHash('sha256');
    let size = 0;

    const hashStream = new Transform({
      transform(chunk, encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });

    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: stream.pipe(hashStream),
        ContentType: contentType,
      },
    });

    try {
      await upload.done();
      const checksumSha256 = hash.digest('hex');
      this.log.info({ key, size, userId }, 'File uploaded successfully');
      return { key, size, checksumSha256 };
    } catch (error) {
      this.log.error({ err: error, key, userId }, 'File upload failed');
      // Attempt to clean up partial upload
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (cleanupError) {
        this.log.error({ err: cleanupError, key }, 'Failed to clean up partial upload');
      }
      throw AppError.internal('File upload failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async download(key: string): Promise<{ stream: Readable; metadata: FileMetadata }> {
    const client = this.ensureClient();
    const bucket = this.getBucket();

    try {
      const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const headResponse = await client.send(headCommand);

      const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
      const getResponse = await client.send(getCommand);

      if (!getResponse.Body) {
        throw AppError.notFound('File content not found', ErrorCodes.S3_OBJECT_MISSING);
      }

      const stream = getResponse.Body as Readable;
      const metadata: FileMetadata = {
        size: Number(headResponse.ContentLength || 0),
        contentType: headResponse.ContentType || 'application/octet-stream',
        lastModified: headResponse.LastModified || new Date(),
        checksumSha256: headResponse.Metadata?.['checksum-sha256'],
      };

      return { stream, metadata };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.log.error({ err: error, key }, 'File download failed');
      if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
        throw AppError.notFound('File not found in storage', ErrorCodes.S3_OBJECT_MISSING);
      }
      throw AppError.internal('File download failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async delete(key: string): Promise<void> {
    const client = this.ensureClient();
    const bucket = this.getBucket();

    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      this.log.info({ key }, 'File deleted successfully');
    } catch (error) {
      this.log.error({ err: error, key }, 'File deletion failed');
      if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
        throw AppError.notFound('File not found in storage', ErrorCodes.S3_OBJECT_MISSING);
      }
      throw AppError.internal('File deletion failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const client = this.ensureClient();
    const bucket = this.getBucket();

    try {
      const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const response = await client.send(command);

      return {
        size: Number(response.ContentLength || 0),
        contentType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified || new Date(),
        checksumSha256: response.Metadata?.['checksum-sha256'],
      };
    } catch (error) {
      this.log.error({ err: error, key }, 'Failed to get file metadata');
      if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
        throw AppError.notFound('File not found in storage', ErrorCodes.S3_OBJECT_MISSING);
      }
      throw AppError.internal('Failed to get file metadata', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    const client = this.ensureClient();
    const bucket = this.getBucket();

    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${sourceKey}`,
          Key: destinationKey,
        })
      );
      this.log.info({ sourceKey, destinationKey }, 'File copied successfully');
    } catch (error) {
      this.log.error({ err: error, sourceKey, destinationKey }, 'File copy failed');
      if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
        throw AppError.notFound('Source file not found in storage', ErrorCodes.S3_OBJECT_MISSING);
      }
      throw AppError.internal('File copy failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async generatePresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<PresignedUrlResult> {
    const client = this.ensureClient();
    const bucket = this.getBucket();

    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
      return { url, expiresIn: expiresInSeconds };
    } catch (error) {
      this.log.error({ err: error, key }, 'Failed to generate presigned URL');
      throw AppError.internal('Failed to generate download URL', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async generatePresignedUploadUrl(
    userId: string,
    originalFilename: string,
    contentType: string,
    expiresInSeconds = 3600
  ): Promise<{ key: string; url: string; expiresIn: number }> {
    const client = this.ensureClient();
    const bucket = this.getBucket();
    const key = this.generateObjectKey(userId, originalFilename);

    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
      return { key, url, expiresIn: expiresInSeconds };
    } catch (error) {
      this.log.error({ err: error, key }, 'Failed to generate presigned upload URL');
      throw AppError.internal('Failed to generate upload URL', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client || !this.config) {
      return false;
    }

    try {
      // Use ListObjectsV2 with max-keys=1 for a lightweight connectivity check
      // This is more reliable than HEAD bucket and works across S3 implementations
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        MaxKeys: 1,
      });

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), 5000);
      });

      await Promise.race([this.client.send(command), timeoutPromise]);
      return true;
    } catch (error) {
      this.log.warn({ err: error }, 'Storage health check failed');
      return false;
    }
  }
}

// Transform stream for hashing while piping

export const storageService = new StorageService();

// Initialize on module load
storageService.initialize();