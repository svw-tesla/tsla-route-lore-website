#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { CertificateStack } from '../lib/certificate-stack';
import { SiteStack } from '../lib/site-stack';

const app = new App();

const ZONE_NAME = 'routelore.app';
const GITHUB_ORG_REPO = 'svw-tesla/tsla-route-lore-website';
// Auto-created by Route53Domains when routelore.app was registered under
// this account — do not create a second zone, import this one.
const HOSTED_ZONE_ID = 'Z057646936X4M5T8NMSDD';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const certStack = new CertificateStack(app, 'RouteLoreCertificateStack', {
  env: { account: env.account, region: 'us-east-1' },
  crossRegionReferences: true,
  zoneName: ZONE_NAME,
  hostedZoneId: HOSTED_ZONE_ID,
});

new SiteStack(app, 'RouteLoreSiteStack', {
  env: { account: env.account, region: 'us-east-2' },
  crossRegionReferences: true,
  zoneName: ZONE_NAME,
  hostedZone: certStack.hostedZone,
  certificate: certStack.certificate,
  githubOrgRepo: GITHUB_ORG_REPO,
});
