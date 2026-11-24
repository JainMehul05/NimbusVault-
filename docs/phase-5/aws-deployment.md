# AWS deployment guide

**Status: ready to run, never run.** No AWS account exists for this project, so every step below is DEFERRED and unverified against real AWS. Read [cost.md](cost.md) first: production is about $75 a month.

## 0. Prerequisites

- An AWS account with MFA on the root user, and an administrator identity for the first run (IAM Identity Center recommended; avoid access keys on the root user).
- AWS CLI v2, Docker, Node.js 22, `jq`, Bash (Git Bash or WSL on Windows).
- `npm ci` in the repository root.

```bash
aws sso login                       # or: aws configure
aws sts get-caller-identity         # must show the intended account
export ENVIRONMENT=staging AWS_REGION=us-east-1
export CDK_CONTEXT="githubRepo=JainMehul05/NimbusVault- alarmEmail=you@example.com"
```

## 1. Preview (free, read-only)

```bash
cd infra && npx cdk synth -c env=$ENVIRONMENT && cd ..
cd infra && npx cdk diff -c env=$ENVIRONMENT && cd ..
```

## 2. Bootstrap once per account and region

```bash
bash infra/scripts/bootstrap.sh
```

Creates the CDK toolkit, the image registry and the GitHub deploy role. Copy the printed role ARN.

## 3. First deployment

```bash
export IMAGE_TAG=$(git rev-parse HEAD)
bash infra/scripts/push-image.sh
bash infra/scripts/deploy.sh        # about 25 minutes the first time (RDS, CloudFront)
bash infra/scripts/verify.sh
```

`deploy.sh` notices that nothing exists yet, creates the platform with no running tasks, applies the migrations (including `CREATE EXTENSION vector`), then starts the services and publishes the site. Confirm the SNS subscription e-mail, or alarms will not reach you. Activate the `Project` cost-allocation tag in the billing console so the budget can filter on it.

## 4. Optional: summaries and answers

```bash
export CDK_CONTEXT="$CDK_CONTEXT aiGenerationProvider=anthropic"
bash infra/scripts/deploy.sh
aws secretsmanager list-secrets --query "SecretList[?starts_with(Description, 'API key for')].ARN"
aws secretsmanager put-secret-value --secret-id <that ARN> --secret-string "<your key>"
aws ecs update-service --cluster <ClusterName> --service nimbusvault-$ENVIRONMENT-api --force-new-deployment
aws ecs update-service --cluster <ClusterName> --service nimbusvault-$ENVIRONMENT-worker --force-new-deployment
```

This sends relevant document passages to the provider; the app tells users so.

## 5. Optional: custom domain

Request a certificate in **us-east-1**, validate it, then add `domainName=vault.example.com certificateArn=arn:aws:acm:us-east-1:...` to `CDK_CONTEXT`, deploy, and point a CNAME/ALIAS at the distribution.

## 6. Continuous deployment

In GitHub: Settings → Environments → create `staging` and `production` (add required reviewers to production) with variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION` and `CDK_CONTEXT`. Then run the **Deploy** workflow. See [ci-cd.md](ci-cd.md).

## 7. Verify live (all DEFERRED)

- [ ] `verify.sh` passes
- [ ] Sign up, upload, download, share and search through the CloudFront URL
- [ ] The load balancer and database are unreachable from the internet
- [ ] `SELECT extversion FROM pg_extension WHERE extname = 'vector'` is 0.8 or newer
- [ ] A test alarm e-mail arrives
- [ ] A point-in-time restore has been rehearsed ([operations.md](operations.md))

## Teardown

```bash
ENVIRONMENT=staging AWS_REGION=us-east-1 bash infra/scripts/teardown.sh staging
```

Keeps the file bucket and a final database snapshot, and says how to delete them.
