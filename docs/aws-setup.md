# AWS Setup for Phase 2

## Overview

This document describes the AWS infrastructure preparation for NimbusVault Phase 2, which will implement file storage using Amazon S3.

## IAM User Creation

### 1. Create IAM User
```bash
aws iam create-user --user-name nimbusvault-app
```

### 2. Create Access Keys
```bash
aws iam create-access-key --user-name nimbusvault-app
```
**Save the Access Key ID and Secret Access Key securely.**

### 3. Attach Custom Policy
Create policy file `nimbusvault-s3-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetObjectVersion",
        "s3:DeleteObjectVersion"
      ],
      "Resource": [
        "arn:aws:s3:::nimbusvault-files-*",
        "arn:aws:s3:::nimbusvault-files-*/*"
      ]
    },
    {
      "Sid": "S3BucketLocation",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::nimbusvault-files-*"
      ]
    }
  ]
}
```

Attach policy:
```bash
aws iam put-user-policy \
  --user-name nimbusvault-app \
  --policy-name NimbusVaultS3Access \
  --policy-document file://nimbusvault-s3-policy.json
```

## S3 Bucket Creation

### 1. Create Bucket
```bash
# Replace with your preferred region
aws s3api create-bucket \
  --bucket nimbusvault-files-prod \
  --region us-east-1 \
  --create-bucket-configuration LocationConstraint=us-east-1
```

For regions other than us-east-1:
```bash
aws s3api create-bucket \
  --bucket nimbusvault-files-prod \
  --region eu-west-1 \
  --create-bucket-configuration LocationConstraint=eu-west-1
```

### 2. Enable Versioning
```bash
aws s3api put-bucket-versioning \
  --bucket nimbusvault-files-prod \
  --versioning-configuration Status=Enabled
```

### 3. Enable Server-Side Encryption (SSE-S3)
```bash
aws s3api put-bucket-encryption \
  --bucket nimbusvault-files-prod \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        },
        "BucketKeyEnabled": true
      }
    ]
  }'
```

### 4. Configure CORS
Create `cors-config.json`:

```json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedOrigins": [
        "http://localhost:5173",
        "https://app.nimbusvault.com"
      ],
      "ExposeHeaders": ["ETag", "x-amz-request-id"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

Apply CORS:
```bash
aws s3api put-bucket-cors \
  --bucket nimbusvault-files-prod \
  --cors-configuration file://cors-config.json
```

### 5. Block Public Access
```bash
aws s3api put-public-access-block \
  --bucket nimbusvault-files-prod \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### 6. Lifecycle Policy (Optional - Cost Optimization)
Create `lifecycle.json`:

```json
{
  "Rules": [
    {
      "ID": "TransitionToIA",
      "Status": "Enabled",
      "Filter": {},
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        },
        {
          "Days": 365,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ]
    },
    {
      "ID": "DeleteIncompleteMultipartUploads",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    }
  ]
}
```

Apply:
```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket nimbusvault-files-prod \
  --lifecycle-configuration file://lifecycle.json
```

## Development Environment

### Development Bucket
```bash
aws s3api create-bucket \
  --bucket nimbusvault-files-dev \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket nimbusvault-files-dev \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket nimbusvault-files-dev \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'
```

### Development CORS
```bash
aws s3api put-bucket-cors \
  --bucket nimbusvault-files-dev \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
        "AllowedOrigins": ["http://localhost:5173"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
      }
    ]
  }'
```

## Phase 2 Integration Plan

### Backend Changes

#### 1. File Service (`src/modules/files/file.service.ts`)
```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({ region: config.aws.region });

export class FileService {
  async generateUploadUrl(fileName: string, contentType: string, userId: string) {
    const key = `users/${userId}/${Date.now()}-${fileName}`;
    const command = new PutObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
      ContentType: contentType,
    });
    
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { uploadUrl, key };
  }

  async generateDownloadUrl(key: string) {
    const command = new GetObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
    });
    
    return getSignedUrl(s3Client, command, { expiresIn: 3600 });
  }

  async deleteFile(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
    });
    
    await s3Client.send(command);
  }
}
```

#### 2. File Metadata Model (Prisma)
```prisma
model File {
  id        String   @id @default(uuid())
  userId    String
  folderId  String?
  name      String
  mimeType  String
  size      BigInt
  s3Key     String
  checksum  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  folder    Folder?  @relation(fields: [folderId], references: [id])

  @@index([userId])
  @@index([folderId])
  @@map("files")
}
```

#### 3. Upload Flow
```
1. Client requests upload URL: POST /api/v1/files/upload-url
   { fileName, mimeType, size }
   
2. Backend generates presigned PUT URL
   Returns: { uploadUrl, key, fileId }
   
3. Client PUTs file directly to S3
   
4. Client confirms upload: POST /api/v1/files/confirm
   { fileId, key, checksum }
   
5. Backend verifies checksum, creates File record
```

#### 4. Download Flow
```
1. Client requests download: GET /api/v1/files/:id/download
   
2. Backend generates presigned GET URL
   Returns: { downloadUrl }
   
3. Client downloads directly from S3
```

### Frontend Changes

#### 1. File Upload Component
- Drag-and-drop zone
- Progress tracking
- Direct S3 upload with presigned URL
- Checksum calculation (Web Crypto API)

#### 2. File List/Grid
- Thumbnail previews
- File metadata display
- Context menu (download, share, delete)

#### 3. Folder Navigation
- Breadcrumb navigation
- Tree view sidebar
- Drag-and-drop organization

## Security Considerations

### 1. Presigned URL Expiration
- Upload URLs: 1 hour
- Download URLs: 1 hour
- Short-lived to limit exposure

### 2. File Validation
- MIME type verification
- Size limits (configurable)
- Checksum verification (SHA-256)
- Virus scanning (future: ClamAV/Lambda)

### 3. Access Control
- User-scoped S3 keys: `users/{userId}/...`
- Database-backed permissions
- Share links with expiration

### 4. Encryption
- SSE-S3 (AES-256) at rest
- TLS 1.2+ in transit
- Client-side encryption option (future)

## Monitoring & Alerting

### CloudWatch Metrics
- Bucket size
- Request count/latency
- Error rates
- Data transfer

### Alarms
- Unusual upload spikes
- High error rates
- Storage cost thresholds

## Cost Optimization

### Storage Classes
| Access Pattern | Storage Class |
|----------------|---------------|
| Frequently accessed | STANDARD |
| Infrequent (30+ days) | STANDARD_IA |
| Archive (90+ days) | GLACIER |
| Long-term archive (365+ days) | DEEP_ARCHIVE |

### Intelligent Tiering
```bash
aws s3api put-bucket-intelligent-tiering-configuration \
  --bucket nimbusvault-files-prod \
  --id "AutoTiering" \
  --intelligent-tiering-configuration '{
    "Id": "AutoTiering",
    "Status": "Enabled",
    "Filter": {},
    "Tierings": [
      { "Days": 30, "AccessTier": "ARCHIVE_ACCESS" },
      { "Days": 90, "AccessTier": "DEEP_ARCHIVE_ACCESS" }
    ]
  }'
```

## Environment Variables

### Backend (Phase 2)
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=nimbusvault-files-prod
AWS_S3_BUCKET_DEV=nimbusvault-files-dev
```

### Frontend
No AWS credentials needed (presigned URLs from backend).

## Testing AWS Integration

### LocalStack (Local Development)
```yaml
# docker-compose.yml addition
localstack:
  image: localstack/localstack:latest
  ports:
    - "4566:4566"
  environment:
    - SERVICES=s3
    - DEBUG=1
```

```bash
# Create bucket in LocalStack
aws --endpoint-url=http://localhost:4566 s3api create-bucket --bucket nimbusvault-files-local
```

## Disaster Recovery

### Cross-Region Replication
```bash
aws s3api put-bucket-replication \
  --bucket nimbusvault-files-prod \
  --replication-configuration '{
    "Role": "arn:aws:iam::123456789:role/replication-role",
    "Rules": [
      {
        "ID": "ReplicateToDR",
        "Status": "Enabled",
        "Priority": 1,
        "DeleteMarkerReplication": { "Status": "Disabled" },
        "Filter": {},
        "Destination": {
          "Bucket": "arn:aws:s3:::nimbusvault-files-dr",
          "StorageClass": "STANDARD"
        }
      }
    ]
  }'
```

### Backup Verification
- Weekly restore tests
- Checksum validation
- RTO/RPO documentation

## Compliance

### Data Residency
- Bucket per region for GDPR/CCPA
- User data stays in selected region

### Audit Logging
```bash
aws s3api put-bucket-logging \
  --bucket nimbusvault-files-prod \
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "nimbusvault-access-logs",
      "TargetPrefix": "s3-access-logs/"
    }
  }'
```

## Checklist for Phase 2 Launch

- [ ] IAM user with least-privilege policy
- [ ] Production S3 bucket created
- [ ] Versioning enabled
- [ ] SSE-S3 encryption enabled
- [ ] CORS configured for production domain
- [ ] Public access blocked
- [ ] Lifecycle policies applied
- [ ] Development bucket configured
- [ ] LocalStack integration for local dev
- [ ] Presigned URL implementation tested
- [ ] File upload/download flows working
- [ ] Checksum verification implemented
- [ ] Monitoring/alarms configured
- [ ] Cost optimization reviewed
- [ ] Disaster recovery tested
- [ ] Compliance requirements met