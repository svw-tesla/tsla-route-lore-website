import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration, Arn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface SiteStackProps extends StackProps {
  readonly zoneName: string;
  readonly hostedZone: route53.IHostedZone;
  readonly certificate: acm.ICertificate;
  /** OIDC token "sub" claim to trust, e.g.
   * "repo:svw-tesla@306577278/tsla-route-lore-website@1305129692:ref:refs/heads/main".
   * This enterprise (smith-varmint-works-llc) has GitHub's immutable-ID OIDC
   * subject claims enabled, so the sub embeds numeric org/repo IDs
   * (repo:<org>@<org_id>/<repo>@<repo_id>:ref:...) instead of the plain-name
   * form most examples show — a plain-name StringLike condition never
   * matches and AssumeRoleWithWebIdentity fails with an opaque "Not
   * authorized" error. Confirm the exact string via a token debug step
   * before changing this. */
  readonly githubOidcSub: string;
}

/**
 * Private S3 origin + CloudFront + DNS + a GitHub OIDC deploy role scoped to
 * this bucket/distribution only. Everything here is us-east-2; the
 * certificate is a cross-region reference from CertificateStack (us-east-1).
 */
export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    const apex = props.zoneName;
    const www = `www.${props.zoneName}`;

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // www -> apex redirect at the edge; both names share one distribution/cert.
    const wwwRedirectFn = new cloudfront.Function(this, 'WwwRedirectFunction', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;
  if (host === '${www}') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://${apex}' + request.uri }
      }
    };
  }
  return request;
}
`),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      domainNames: [apex, www],
      certificate: props.certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: wwwRedirectFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });

    for (const [id, recordName] of [
      ['ApexA', apex],
      ['WwwA', www],
    ] as const) {
      new route53.ARecord(this, id, {
        zone: props.hostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
      new route53.AaaaRecord(this, `${id}aaaa`, {
        zone: props.hostedZone,
        recordName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }

    const githubOidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubOidc',
      Arn.format({ service: 'iam', resource: 'oidc-provider', resourceName: 'token.actions.githubusercontent.com', region: '' }, this),
    );

    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'tsla-route-lore-website-deploy',
      assumedBy: new iam.FederatedPrincipal(
        githubOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': props.githubOidcSub,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
      maxSessionDuration: Duration.hours(1),
    });

    siteBucket.grantReadWrite(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [siteBucket.bucketArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          Arn.format(
            { service: 'cloudfront', resource: 'distribution', resourceName: distribution.distributionId, region: '' },
            this,
          ),
        ],
      }),
    );

    new CfnOutput(this, 'BucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
