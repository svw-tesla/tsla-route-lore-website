# tsla-route-lore-website

RouteLore public website — routelore.app

Public copy rule (ADR-0002): the site says **RouteLore** only. No "TeslaApp",
internal jargon, or wording implying Tesla affiliation/endorsement.

## Architecture

```
GitHub Actions (push to main)
  -> assume DeployRole via GitHub OIDC (no long-lived AWS keys)
  -> aws s3 sync site/ -> S3 bucket (private, OAC only)
  -> CloudFront invalidation

routelore.app / www.routelore.app
  -> Route 53 alias records
  -> CloudFront distribution (ACM cert, us-east-1)
  -> S3 origin via Origin Access Control (no public bucket access)
```

Infra is CDK v2/TypeScript, two stacks (`infra/`):

- `RouteLoreCertificateStack` (us-east-1 — CloudFront requires ACM certs
  there) — owns the `routelore.app` Route 53 hosted zone and the ACM
  certificate (DNS-validated, covers apex + `www`).
- `RouteLoreSiteStack` (us-east-2) — S3 bucket, CloudFront distribution,
  Route 53 A/AAAA alias records, and the GitHub OIDC deploy role. Consumes
  the zone and certificate from the cert stack via CDK cross-region stack
  references (`crossRegionReferences: true`).

A single literal CloudFormation stack can't span two regions, which is why
this is two stacks instead of the one the original brief describes — a hard
AWS constraint (ACM certs for CloudFront must live in us-east-1), not a
scope choice.

The `www` -> apex redirect is a CloudFront Function (`viewer-request`) on the
one shared distribution, rather than a second distribution.

## The `.well-known` path

This domain will eventually serve
`/.well-known/appspecific/com.tesla.3p.public-key.pem` for Tesla Fleet API
registration. That key is **not** part of this brief (TSLA-0003) — publishing
a placeholder or fake key now could poison the real registration later. All
this brief proves is that the path routes through CloudFront/S3 without
being blocked (a 404 there is fine).

## Deploy flow

Every push to `main` runs `scripts/run_tests.sh`, then (push only, not PRs)
assumes the deploy role via GitHub OIDC, syncs `site/` to the bucket, and
invalidates the CloudFront cache. No manual steps, no long-lived AWS keys in
GitHub — auth is `aws-actions/configure-aws-credentials` via OIDC, scoped to
`repo:svw-tesla/tsla-route-lore-website:ref:refs/heads/main` only.

Repo variables consumed by the workflow (set from CDK stack outputs, no
secrets involved):

- `AWS_DEPLOY_ROLE_ARN`
- `SITE_BUCKET`
- `CF_DISTRIBUTION_ID`

## One-time bootstrap

CI cannot deploy until the infra exists — the deploy role, bucket, and
distribution are created by an operator-run `cdk deploy`, once:

```bash
cd infra
npm install
AWS_PROFILE=tennis@charliesfarm npx cdk bootstrap aws://<account-id>/us-east-1
AWS_PROFILE=tennis@charliesfarm npx cdk bootstrap aws://<account-id>/us-east-2
AWS_PROFILE=tennis@charliesfarm npx cdk deploy --all
```

The hosted zone is created by this same deploy (`RouteLoreCertificateStack`).
Its `NameServers` output must be delegated to at the domain's registrar
before ACM DNS validation can complete — `cdk deploy` will sit waiting on
certificate issuance until that delegation is live and has propagated.

After the deploy, set the workflow's repo variables from the stack outputs:

```bash
gh variable set AWS_DEPLOY_ROLE_ARN --body "<DeployRoleArn output>"
gh variable set SITE_BUCKET --body "<BucketName output>"
gh variable set CF_DISTRIBUTION_ID --body "<DistributionId output>"
```

## Tests

`scripts/run_tests.sh` (no AWS credentials required):

- HTML sanity check of `site/` (stdlib `html.parser`, no external tool
  dependency — the system `tidy` binary predates HTML5 and rejects
  `<main>`/`<footer>`)
- `.github/workflows/deploy.yml` YAML parses (`ruby -ryaml`)
- `cdk synth` succeeds
