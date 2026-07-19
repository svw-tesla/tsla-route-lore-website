import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface CertificateStackProps extends StackProps {
  readonly zoneName: string;
  /** Existing public hosted zone ID for zoneName — routelore.app already has
   * one, auto-created by Route53Domains when the domain was registered. */
  readonly hostedZoneId: string;
}

/**
 * Imports the existing routelore.app hosted zone and owns the CloudFront
 * ACM certificate. Must deploy to us-east-1 — CloudFront only accepts certs
 * from that region.
 */
export class CertificateStack extends Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });
    this.hostedZone = zone;

    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.zoneName,
      subjectAlternativeNames: [`www.${props.zoneName}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new CfnOutput(this, 'HostedZoneId', { value: zone.hostedZoneId });
    new CfnOutput(this, 'CertificateArn', { value: this.certificate.certificateArn });
  }
}
