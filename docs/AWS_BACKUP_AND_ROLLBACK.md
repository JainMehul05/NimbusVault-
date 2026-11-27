## Session B resource inventory (tagged NimbusVaultDeployment; ledger `.runtime/aws-deployment/resource-ledger.json`)
Created: CloudFront VPC origin `vo_2c3gnAzOKMfBMVqPUe7ZaV`; SG `nimbusvault-apigw-vpclink`; Cloud Map HTTP namespace `nimbusvault`, service `web` and the instance registration; API Gateway VPC link `nimbusvault-vpclink`; HTTP API `d00xx7hyr7` ($default route and stage); stop schedules created and removed per session. Modified: app SG +8080 from the VPC-origin SG and from the VPC-link SG; instance tags. Temporary S3 patch objects deleted. Rollback (needs approval): delete the HTTP API, VPC link, Cloud Map instance/service/namespace, VPC-link SG and VPC origin; revoke both 8080 rules; run `ec2-public-config.sh private` on the host. `aws:backup` re-run 12:25 UTC (Success).

---

# AWS backup, recovery, rollback and cleanup

## EC2 application backup (verified)
`npm run aws:backup` runs `deployment/backup-linux.sh` on the host through SSM: pg_dump (custom format), SQLite online backup with integrity check, private env files, compose file, source checkpoint and a SHA-256 manifest under `/opt/nimbusvault-private/backups/<UTC stamp>/` (root-only, on encrypted EBS). Verified 27 Nov: checksums ok; isolated restore into a scratch database matched **12/12** public tables row-for-row; SQLite `integrity_check = ok` (11 tables). The backup contains secrets and is never uploaded. No EBS snapshots were created (they would consume credits); create one only by explicit decision.

## Deployment identity (for rebuild)
Source commit recorded on host (`/opt/nimbusvault/SOURCE_CHECKPOINT`) plus thin patch layers built on the host from reviewed files (`nimbusvault-ec2-api:prepared` 731b6898…, `intelligence:prepared` 0bd7b5e2…, originals kept as `:bundled`). Bundle hashes: images 3958470e…, models f530c0e9…, source 7f2d00f3…; Qwen digest 357c53fb…; MiniLM snapshot 1110a243…. The local bundle remains at `.runtime/aws-deployment/bundle/`.

## Original S3 data (optional, not approved)
16 pre-existing originals (3,110,073 bytes) plus 3 synthetic files exist under `cloudvault/files/`. Export procedure if you approve it: list keys → `aws s3 cp` each to a private local folder → SHA-256 manifest → compare with S3 `ChecksumSHA256`/size → keep offline. Estimated transfer ≈3 MB (negligible credits). Required before the Free plan ends (24 May 2027).

## Rollback
- Application: re-tag `:bundled` images to `:prepared` and `docker compose up -d`; or restore a backup with `pg_restore` and copy `evidence.db` into the intelligence volume.
- Cloud mode: `deployment/ec2-apply-patch.sh - <operations> <writes>` (currently `true false`).
- Serverless idle state: rule `cloudvault-v3-dev-uploads` DISABLED, mapping Disabled (verified).

## Inventory and dry-run cleanup (requires your explicit approval — nothing below has been run)
| Resource | Delete command (dry list) | Effect |
|---|---|---|
| Instance i-0569d222e63fc7f36 + volume vol-0c3b9f3604b9d7a67 (DeleteOnTermination) | `aws ec2 terminate-instances --instance-ids i-0569d222e63fc7f36` | Stops EBS charges; **destroys deployed data** — back up first |
| SG sg-0fce31aed9cee47dc | `aws ec2 delete-security-group --group-id sg-0fce31aed9cee47dc` | after termination |
| Instance profile/role nimbusvault-ec2-demo-20261127 | remove role from profile, delete profile, delete inline policy, detach SSM core, delete role | — |
| Role nimbusvault-ec2-safety-20261127 | delete inline policy, delete role | — |
| Schedules nimbusvault-ec2-stop/restore-rule/restore-consumer-20261127 | `aws scheduler delete-schedule --name …` | completed one-time schedules cost nothing |
| Synthetic S3 originals (3) and derived canary | not deleted (role denies deletes; originals are create-only) | ≈1 KB |
Never target the CloudFormation stack `cloudvault-v3-dev`, its queues, table, vectors, or pre-existing objects.
