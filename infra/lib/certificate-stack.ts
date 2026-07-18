import { Stack, StackProps, CfnOutput, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface CertificateStackProps extends StackProps {
  readonly zoneName: string;
}

/**
 * Owns the routelore.app hosted zone and the CloudFront ACM certificate.
 * Must deploy to us-east-1 — CloudFront only accepts certs from that region.
 * The hosted zone itself is region-agnostic; it lives here so DNS validation
 * of the certificate doesn't require a cross-region reference back to it.
 */
export class CertificateStack extends Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props);

    const zone = new route53.PublicHostedZone(this, 'Zone', {
      zoneName: props.zoneName,
    });
    this.hostedZone = zone;

    this.certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.zoneName,
      subjectAlternativeNames: [`www.${props.zoneName}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    new CfnOutput(this, 'HostedZoneId', { value: zone.hostedZoneId });
    new CfnOutput(this, 'NameServers', {
      value: Fn.join(',', zone.hostedZoneNameServers ?? []),
      description: 'Delegate routelore.app at the registrar to these name servers',
    });
    new CfnOutput(this, 'CertificateArn', { value: this.certificate.certificateArn });
  }
}
