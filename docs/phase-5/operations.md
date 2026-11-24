# Operations: backup, recovery, rollback, monitoring

All AWS procedures here are written from the infrastructure definitions and have **not been rehearsed** on real AWS.

## Backups

| What | How | Retention |
|---|---|---|
| Database | RDS automated snapshots and transaction logs (point-in-time recovery) | 14 days production, 1 day staging |
| Database, on deletion | Final snapshot | Until deleted by hand |
| Files | S3 versioning | Deleted or overwritten versions 30 days (production) |
| User-level | Trash in the app | `TRASH_RETENTION_DAYS` (30) |
| Configuration | Git | Forever |

Local development: `docker compose exec -T postgres pg_dump -U postgres -Fc nimbusvault > backup.dump` and `pg_restore --clean --if-exists`.

## Restore the database

```bash
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier nimbusvault-production \
  --target-db-instance-identifier nimbusvault-restore --restore-time 2026-01-31T10:00:00Z \
  --db-subnet-group-name <same group> --vpc-security-group-ids <DbSg>
```

Check the data, then either copy the rows you need back, or rename the instances so the restored one takes the original identifier. Objects deleted since the restore point can be recovered from S3 versions: list them with `aws s3api list-object-versions --prefix <owner id>/` and delete the delete markers.

Target: recovery point 5 minutes (RDS log shipping), recovery time about 1 hour.

## Roll back

| Problem | Action |
|---|---|
| New tasks unhealthy | Automatic (ECS circuit breaker) |
| Bad release already live | Deploy workflow with `image_tag=<previous SHA>`, or `IMAGE_TAG=<sha> bash infra/scripts/deploy.sh` |
| Bad web app only | Redeploy the older tag; old hashed assets are still in the bucket |
| Failed migration | Nothing to do: services are only rolled after it succeeds. Fix forward |
| Data damage | Point-in-time restore (above) |

Migrations are additive by policy, so the previous release keeps working on the new schema. Never edit an applied migration.

## Monitoring

Alarms go to the SNS topic (e-mail). Dashboard: CloudWatch → `NimbusVault-<env>`.

| Alarm | First thing to check |
|---|---|
| Alb5xx, UnhealthyHosts | ECS service events; API log group |
| Target5xx, LoggedServerErrors | API logs: `{ $.event = "http_5xx" }`, then follow `requestId` |
| SlowResponses, DbCpu | RDS slow-query log (over 1 s) |
| AiJobFailed, AiQueueBacklog | Worker logs; provider status; is the worker running? |
| MaintenanceFailed | Worker logs: `{ $.event = "maintenance_failed" }` |
| DbStorage, DbMemory, DbConnections | Scale with `-c dbInstanceSize=small` |
| Budget | Cost Explorer by service |

Logs are JSON with request ids. They contain user ids, IP addresses and file ids, but no document text, passwords, tokens or share-link tokens.

## Rotate secrets

| Secret | Procedure | Effect |
|---|---|---|
| JWT access key | `aws secretsmanager put-secret-value` with 64 random characters, force a new API deployment | Access tokens are reissued silently by the next refresh |
| Database password | `aws rds modify-db-instance --master-user-password`, same value into the secret's `password`, force new deployments | A few seconds of errors |
| AI key | Put the new value, force new deployments | None |
| Everything, after an incident | All of the above, then `UPDATE user_sessions SET "revokedAt" = now()` and the same for `refresh_tokens` | Everyone signs in again |

## Known operational limits

- The application connects as the RDS master user; a restricted runtime role is recommended before handling sensitive data.
- Rate limits are per task, in memory.
- Objects purged from trash remain as noncurrent S3 versions for 30 days.
