import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Transform } from 'stream';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createHash, randomBytes } from 'crypto';
import { config } from '@config/index';
import { createChildLogger } from '@common/logger';
import { AppError } from '@common/errors';
import { ErrorCodes } from '@common/errors';
import { intelligence, intelligenceEnabled } from './intelligence';
import { Readable as BufferReadable } from 'stream';
import { randomUUID } from 'crypto';

export interface UploadResult {
  key: string;
  size: number;
  checksumSha256: string;
}

export interface FileMetadata {
  size: number;
  contentType: string;
  lastModified: Date;
  etag?: string;
}

export interface PresignedUrlResult {
  url: string;
  expiresIn: number;
}

/** Objects under this prefix are unfinished presigned uploads; a lifecycle rule expires them. */
export const STAGING_PREFIX = 'staging/';

const isNotFound = (error: unknown): boolean => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

/** The parts of an SDK error that are safe and useful to log. */
const describe = (error: unknown) => {
  const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  return { name: e?.name, message: e?.message, status: e?.$metadata?.httpStatusCode };
};

export class StorageService {
  private client: S3Client | null = null;
  private presignClient: S3Client | null = null;
  private bucket: string | null = null;
  private readonly log = createChildLogger({ module: 'storage' });

  initialize(): void {
    if(intelligenceEnabled()) { this.log.info('Using the guarded private Python storage adapter'); return; }
    if (this.client) return;

    const { region, accessKeyId, secretAccessKey, s3Bucket, s3Endpoint, s3PublicEndpoint, s3ForcePathStyle } = config.aws;
    if (!s3Bucket) {
      this.log.warn('S3 configuration incomplete; storage operations will fail until configured');
      return;
    }

    const build = (endpoint: string) =>
      new S3Client({
        region,
        ...(endpoint ? { endpoint } : {}),
        // Without static keys the SDK uses its default chain (ECS task role on AWS).
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
        forcePathStyle: s3ForcePathStyle,
        // Keep presigned URLs usable by plain HTTP clients and by LocalStack.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });

    this.client = build(s3Endpoint);
    this.presignClient = s3PublicEndpoint === s3Endpoint ? this.client : build(s3PublicEndpoint);
    this.bucket = s3Bucket;
    this.log.info({ endpoint: s3Endpoint || 'aws', bucket: s3Bucket }, 'Storage service initialized');
  }

  private ctx(): { client: S3Client; presign: S3Client; Bucket: string } {
    if (!this.client || !this.presignClient || !this.bucket) {
      throw AppError.serviceUnavailable('Object storage not configured', ErrorCodes.SERVICE_UNAVAILABLE);
    }
    return { client: this.client, presign: this.presignClient, Bucket: this.bucket };
  }

  /** Unguessable key. The user's filename contributes only a short alphanumeric extension. */
  generateObjectKey(userId: string, originalFilename: string): string {
    if (intelligenceEnabled()) return `cloudvault/files/${randomUUID()}/${originalFilename.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    const ext = /\.([A-Za-z0-9]{1,10})$/.exec(originalFilename)?.[1]?.toLowerCase();
    return `${userId}/${Date.now()}-${randomBytes(16).toString('hex')}${ext ? `.${ext}` : ''}`;
  }

  async upload(userId: string, originalFilename: string, stream: Readable, contentType: string): Promise<UploadResult> {
    if (intelligenceEnabled()) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        const part = Buffer.from(chunk); size += part.length;
        if (size > config.storage.maxFileBytes) { stream.destroy(); throw AppError.badRequest('File too large'); }
        chunks.push(part);
      }
      const key = this.generateObjectKey(userId, originalFilename);
      const bytes = Buffer.concat(chunks);
      const result = await intelligence<{size:number;checksumSha256:string}>('/storage', {operation:'put',key,mime:contentType,content:bytes.toString('base64')});
      return {key,...result};
    }
    const { client, Bucket } = this.ctx();
    const key = this.generateObjectKey(userId, originalFilename);

    const hash = createHash('sha256');
    let size = 0;
    const hashStream = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });

    const upload = new Upload({
      client,
      params: { Bucket, Key: key, Body: hashStream, ContentType: contentType },
      leavePartsOnError: false,
    });

    try {
      // pipeline() propagates source errors, so a failing disk read cannot hang the upload.
      await Promise.all([
        pipeline(stream, hashStream).catch(async (err) => {
          await upload.abort().catch(() => {});
          throw err;
        }),
        upload.done(),
      ]);
      this.log.info({ key, size, userId }, 'File uploaded successfully');
      return { key, size, checksumSha256: hash.digest('hex') };
    } catch (error) {
      stream.destroy();
      this.log.error({ err: describe(error), key, userId }, 'File upload failed');
      await client.send(new DeleteObjectCommand({ Bucket, Key: key })).catch((cleanupError) => {
        this.log.error({ err: describe(cleanupError), key }, 'Failed to clean up partial upload');
      });
      throw AppError.internal('File upload failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async download(key: string): Promise<{ stream: Readable; metadata: FileMetadata }> {
    if (intelligenceEnabled()) {
      const result = await intelligence<{content:string;size:number;contentType:string}>('/storage',{operation:'get',key});
      return {stream:BufferReadable.from(Buffer.from(result.content,'base64')),metadata:{size:result.size,contentType:result.contentType,lastModified:new Date()}};
    }
    const { client, Bucket } = this.ctx();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!res.Body) {
        throw AppError.notFound('File content not found', ErrorCodes.S3_OBJECT_MISSING);
      }
      return {
        stream: res.Body as Readable,
        metadata: {
          size: Number(res.ContentLength || 0),
          contentType: res.ContentType || 'application/octet-stream',
          lastModified: res.LastModified || new Date(),
          etag: res.ETag,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isNotFound(error)) throw AppError.notFound('File not found in storage', ErrorCodes.S3_OBJECT_MISSING);
      this.log.error({ err: describe(error), key }, 'File download failed');
      throw AppError.internal('File download failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  /** Streams an object once, returning its SHA-256 and first bytes. */
  async inspect(key: string, headBytes = 4096): Promise<{ checksumSha256: string; head: Buffer; size: number }> {
    const { stream } = await this.download(key);
    const hash = createHash('sha256');
    const head: Buffer[] = [];
    let headSize = 0;
    let size = 0;
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      hash.update(buf);
      size += buf.length;
      if (headSize < headBytes) {
        const part = buf.subarray(0, headBytes - headSize);
        head.push(part);
        headSize += part.length;
      }
    }
    return { checksumSha256: hash.digest('hex'), head: Buffer.concat(head), size };
  }

  async delete(key: string): Promise<void> {
    if (intelligenceEnabled()) { await intelligence('/storage',{operation:'delete',key}); return; }
    const { client, Bucket } = this.ctx();
    try {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
      this.log.info({ key }, 'File deleted successfully');
    } catch (error) {
      if (isNotFound(error)) return; // already gone
      this.log.error({ err: describe(error), key }, 'File deletion failed');
      throw AppError.internal('File deletion failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    if (intelligenceEnabled()) return intelligence('/storage',{operation:'head',key});
    const { client, Bucket } = this.ctx();
    try {
      const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
      return {
        size: Number(res.ContentLength || 0),
        contentType: res.ContentType || 'application/octet-stream',
        lastModified: res.LastModified || new Date(),
        etag: res.ETag,
      };
    } catch (error) {
      if (isNotFound(error)) throw AppError.notFound('File not found in storage', ErrorCodes.S3_OBJECT_MISSING);
      this.log.error({ err: describe(error), key }, 'Failed to get file metadata');
      throw AppError.internal('Failed to get file metadata', ErrorCodes.INTERNAL_ERROR);
    }
  }

  /** Copies an object. With `ifMatch`, fails if the source changed since it was inspected. */
  async copy(sourceKey: string, destinationKey: string, options: { ifMatch?: string; contentType?: string } = {}): Promise<void> {
    if (intelligenceEnabled()) { await intelligence('/storage',{operation:'copy',key:destinationKey,source:sourceKey}); return; }
    const { client, Bucket } = this.ctx();
    try {
      await client.send(
        new CopyObjectCommand({
          Bucket,
          CopySource: `${Bucket}/${sourceKey.split('/').map(encodeURIComponent).join('/')}`,
          Key: destinationKey,
          ...(options.ifMatch ? { CopySourceIfMatch: options.ifMatch } : {}),
          ...(options.contentType ? { MetadataDirective: 'REPLACE' as const, ContentType: options.contentType } : {}),
        })
      );
    } catch (error) {
      if (isNotFound(error)) throw AppError.notFound('Source file not found in storage', ErrorCodes.S3_OBJECT_MISSING);
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) {
        throw AppError.conflict('The uploaded object changed while it was being verified', 'UPLOAD_CHANGED');
      }
      this.log.error({ err: describe(error), sourceKey, destinationKey }, 'File copy failed');
      throw AppError.internal('File copy failed', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async generatePresignedDownloadUrl(
    key: string,
    expiresInSeconds = config.storage.downloadUrlTtlSeconds,
    response: { disposition?: string; contentType?: string } = {}
  ): Promise<PresignedUrlResult> {
    if (intelligenceEnabled()) return intelligence('/storage',{operation:'presign-get',key,expires:Math.min(expiresInSeconds,120),disposition:response.disposition || 'attachment',mime:response.contentType || 'application/octet-stream'});
    const { presign, Bucket } = this.ctx();
    try {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ...(response.disposition ? { ResponseContentDisposition: response.disposition } : {}),
        ...(response.contentType ? { ResponseContentType: response.contentType } : {}),
      });
      return { url: await getSignedUrl(presign, command, { expiresIn: expiresInSeconds }), expiresIn: expiresInSeconds };
    } catch (error) {
      this.log.error({ err: describe(error), key }, 'Failed to generate presigned URL');
      throw AppError.internal('Failed to generate download URL', ErrorCodes.INTERNAL_ERROR);
    }
  }

  /** PUT URL for one exact object. Type and length are signed, so S3 rejects anything else. */
  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds = config.storage.uploadUrlTtlSeconds
  ): Promise<PresignedUrlResult> {
    if (intelligenceEnabled()) throw AppError.badRequest('Use the authenticated multipart upload in this local application');
    const { presign, Bucket } = this.ctx();
    try {
      const command = new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
      const url = await getSignedUrl(presign, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(['host', 'content-type', 'content-length']),
      });
      return { url, expiresIn: expiresInSeconds };
    } catch (error) {
      this.log.error({ err: describe(error), key }, 'Failed to generate presigned upload URL');
      throw AppError.internal('Failed to generate upload URL', ErrorCodes.INTERNAL_ERROR);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (intelligenceEnabled()) return intelligence<{guard:{allowed:boolean}}>('/cloud/status').then(r=>r.guard.allowed).catch(()=>false);
    if (!this.client || !this.bucket) return false;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: AbortSignal.timeout(5000) });
      return true;
    } catch (error) {
      this.log.warn({ err: describe(error) }, 'Storage health check failed');
      return false;
    }
  }
}

export const storageService = new StorageService();

// Initialize on module load
storageService.initialize();
