import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as logs from 'aws-cdk-lib/aws-logs'
import { Construct } from 'constructs'
import { accept, REASONS } from './accepted-risks'
import type { DeployConfig } from './config'
import type { Network } from './network'

const SIZES = { micro: ec2.InstanceSize.MICRO, small: ec2.InstanceSize.SMALL, medium: ec2.InstanceSize.MEDIUM }

/** File storage and database: everything that must survive a redeploy. */
export class Data extends Construct {
  readonly bucket: s3.Bucket
  readonly database: rds.DatabaseInstance

  constructor(scope: Construct, id: string, props: { config: DeployConfig; network: Network; siteOrigin: string; bucketName: string }) {
    super(scope, id)
    const { config, network } = props
    const production = config.envName === 'production'

    const accessLogs = new s3.Bucket(this, 'FilesAccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ id: 'Expire', expiration: Duration.days(config.logRetentionDays) }],
      removalPolicy: RemovalPolicy.RETAIN,
    })
    accept(accessLogs, { S1: 'This bucket is itself the access-log destination.' })

    this.bucket = new s3.Bucket(this, 'Files', {
      serverAccessLogsBucket: accessLogs,
      // Fixed so the CDN's content security policy can name it without a circular reference.
      bucketName: props.bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { id: 'AbandonedMultipartUploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
        // Presigned uploads land here and are copied out on completion.
        { id: 'AbandonedStagingObjects', prefix: 'staging/', expiration: Duration.days(1), noncurrentVersionExpiration: Duration.days(1) },
        // Recovery window for purged files, after which storage is really released.
        { id: 'NoncurrentVersions', noncurrentVersionExpiration: Duration.days(production ? 30 : 7), expiredObjectDeleteMarker: true },
        { id: 'ColdFiles', transitions: [{ storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: Duration.days(30) }] },
      ],
      cors: [
        {
          allowedOrigins: [props.siteOrigin],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT],
          allowedHeaders: ['content-type', 'content-length'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    })

    // Created up front so retention applies from the first line, without a custom resource.
    const instanceIdentifier = `nimbusvault-${config.envName}`
    const dbLogs = new logs.LogGroup(this, 'DatabaseLogs', {
      logGroupName: `/aws/rds/instance/${instanceIdentifier}/postgresql`,
      retention: config.logRetentionDays as logs.RetentionDays,
      removalPolicy: production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    })

    this.database = new rds.DatabaseInstance(this, 'Database', {
      instanceIdentifier,
      // Minor upgrades are then applied by RDS in the maintenance window. 16.x here ships pgvector
      // 0.8 or newer, which iterative HNSW scans need.
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_13 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, SIZES[config.db.instanceSize]),
      vpc: network.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [network.dbSg],
      publiclyAccessible: false,
      databaseName: 'nimbusvault',
      credentials: rds.Credentials.fromGeneratedSecret('nimbusvault'),
      multiAz: config.db.multiAz,
      storageType: rds.StorageType.GP3,
      allocatedStorage: config.db.allocatedGb,
      maxAllocatedStorage: config.db.maxAllocatedGb,
      storageEncrypted: true,
      backupRetention: Duration.days(config.db.backupDays),
      deleteAutomatedBackups: false,
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:30-sun:05:30',
      autoMinorVersionUpgrade: true,
      copyTagsToSnapshot: true,
      deletionProtection: config.db.deletionProtection,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ['postgresql'],

      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      parameters: {
        'rds.force_ssl': '1',
        log_min_duration_statement: '1000',
        // Statement text can contain personal data, so only slow-statement timing is kept.
        log_statement: 'none',
        idle_in_transaction_session_timeout: '60000',
      },
    })
    this.database.node.addDependency(dbLogs)

    accept(this.database, {
      ...(config.db.multiAz ? {} : { RDS3: 'Single-AZ by default for cost; enable with -c dbMultiAz=true. Automated backups give point-in-time recovery.' }),
      ...(config.db.deletionProtection ? {} : { RDS10: 'Staging is disposable; production sets deletion protection.' }),
      RDS11: 'The database has no public address and accepts connections from two security groups only; a non-default port adds nothing.',
      SMG4: REASONS.rotation,
    })
  }
}
