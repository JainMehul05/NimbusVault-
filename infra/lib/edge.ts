import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cf from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import type * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as waf from 'aws-cdk-lib/aws-wafv2'
import { Construct } from 'constructs'
import { accept, REASONS } from './accepted-risks'
import type { DeployConfig } from './config'

/** Deep links such as /files/123 serve the app shell; real assets pass through untouched. */
const SPA_ROUTER = `
function handler(event) {
  var request = event.request;
  var last = request.uri.substring(request.uri.lastIndexOf('/') + 1);
  if (last.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}`

/**
 * One CloudFront distribution serves both the static app and /api, so everything is same-origin:
 * the refresh cookie can be SameSite=Strict and the API needs no public address. The API is
 * reached through a VPC origin, i.e. a load balancer with no internet exposure.
 */
export class Edge extends Construct {
  readonly siteBucket: s3.Bucket
  readonly distribution: cf.Distribution
  readonly siteOrigin: string

  constructor(scope: Construct, id: string, props: { config: DeployConfig; alb: elb.IApplicationLoadBalancer; filesBucketName: string }) {
    super(scope, id)
    const { config } = props
    const production = config.envName === 'production'

    this.siteBucket = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: true,
      lifecycleRules: [{ id: 'OldReleases', noncurrentVersionExpiration: Duration.days(30) }],
      // Rebuildable from source, so it does not need to outlive the stack.
      removalPolicy: RemovalPolicy.DESTROY,
    })

    const headers = new cf.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            // Presigned uploads go straight to S3.
            `connect-src 'self' https://${props.filesBucketName}.s3.${config.region}.amazonaws.com https://${props.filesBucketName}.s3.amazonaws.com`,
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
        },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: true },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cf.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cf.HeadersReferrerPolicy.SAME_ORIGIN },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()', override: true }],
      },
    })

    const router = new cf.Function(this, 'SpaRouter', {
      code: cf.FunctionCode.fromInline(SPA_ROUTER),
      runtime: cf.FunctionRuntime.JS_2_0,
    })

    const site = origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket)
    const api = origins.VpcOrigin.withApplicationLoadBalancer(props.alb, {
      protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
    })

    const base = { viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS, responseHeadersPolicy: headers, compress: true }
    this.distribution = new cf.Distribution(this, 'Cdn', {
      comment: `NimbusVault ${config.envName}`,
      defaultRootObject: 'index.html',
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      // Cheapest edge set: North America and Europe. Raise to PRICE_CLASS_200 for Asia.
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      // The shared *.cloudfront.net certificate fixes its own TLS policy; with a custom domain
      // TLS 1.2 is enforced.
      ...(config.domainName
        ? {
            domainNames: [config.domainName],
            certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', config.certificateArn!),
            minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {}),
      ...(config.enableWaf ? { webAclId: this.webAcl(production).attrArn } : {}),
      defaultBehavior: {
        ...base,
        origin: site,
        // Honours each object's Cache-Control: hashed assets for a year, index.html never.
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: router, eventType: cf.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          ...base,
          origin: api,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cf.AllowedMethods.ALLOW_ALL,
          cachePolicy: cf.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
        },
      },
    })

    accept(this.siteBucket, { S1: 'Holds only the public, static web app; served exclusively through CloudFront.' })
    accept(this.distribution, {
      CFR3: REASONS.urlsCarryTokens,
      ...(config.domainName ? {} : { CFR4: 'The shared *.cloudfront.net certificate fixes its own TLS policy. Set domainName and certificateArn to enforce TLS 1.2.' }),
      ...(config.enableWaf ? {} : { CFR2: 'WAF is opt-in (-c enableWaf=true) to keep the base cost down; the API has its own rate limits.' }),
      CFR1: 'The service is not geographically restricted.',
    })

    this.siteOrigin = `https://${config.domainName ?? this.distribution.distributionDomainName}`
  }

  private webAcl(production: boolean): waf.CfnWebACL {
    const managed = (name: string, priority: number, exclude: string[] = []): waf.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name,
          // File uploads legitimately exceed the 8 KB body the common rules allow.
          ruleActionOverrides: exclude.map((rule) => ({ name: rule, actionToUse: { count: {} } })),
        },
      },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true },
    })
    return new waf.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'nimbusvault', sampledRequestsEnabled: true },
      rules: [
        {
          name: 'RateLimit',
          priority: 0,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: production ? 2000 : 1000, aggregateKeyType: 'IP' } },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'RateLimit', sampledRequestsEnabled: true },
        },
        managed('AWSManagedRulesAmazonIpReputationList', 1),
        managed('AWSManagedRulesCommonRuleSet', 2, ['SizeRestrictions_BODY', 'CrossSiteScripting_BODY']),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 3),
      ],
    })
  }
}
