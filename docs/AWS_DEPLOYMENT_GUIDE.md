# AWS deployment and operation guide

## Prerequisites (laptop)
AWS CLI v2 with profile `default` (your login), the project's Python venv (`intelligence/.venv`), Session Manager plugin (bundled privately under `.runtime/aws-deployment/tools/ssm-portable`).

## Every new session (needs your approval first)
1. Approve a bounded session in chat. The agent records `.runtime/aws-deployment/authorization.json` (deadline, credits, scope).
2. Re-arm safeguards for that session: update instance tag `NimbusStopDeadline` (absolute UTC), create a new one-time external stop schedule, update `stop_deadline`/`external_stop_schedule_arn` in `approved-instance.json` and `expires_at` in the host's `/opt/nimbusvault-private/authorized-instance.json`.
3. `npm run aws:start` → `npm run aws:connect` → open `http://127.0.0.1:3200` → `npm run aws:warmup`.
4. Finish with `npm run aws:stop` (verifies `stopped`).
Without steps 1–2, `aws:start` refuses, and a started instance would power itself off within 10 minutes (missing/expired deadline fails closed).

## How Session A was deployed (reproducible)
1. `scripts/prepare-ec2-bundle.py` → sanitized bundle (source, Linux images, MiniLM + Qwen) with per-file SHA-256.
2. Upload bundle to `s3://…/cloudvault/deployment/nimbus/<date>/` (outside the event prefix).
3. Create scoped roles + SG; `scripts/aws-launch-session.py` (launch with `deployment/bootstrap-guard.sh` user-data, external stop schedule).
4. SSM: write host authorization manifest; `deployment/install-host.sh` (Docker, signed AWS CLI v2); `deployment/ec2-deploy.sh` (download with instance role, hash check, `docker load`, `configure-host.py` host-only secrets, systemd units, start).
5. `deployment/ec2-verify-host.sh`, `scripts/verify-ec2-application.py`, `scripts/verify-ec2-browser.cjs`, `scripts/aws-native-window.py`.
6. Delete the temporary bundle objects; stop.

## Cloud modes on the host
`bash deployment/ec2-apply-patch.sh - <AWS_OPERATIONS_ENABLED> <AWS_WRITES_ENABLED>` (via `scripts/aws-ssm-run.py --file`). Current: `true false` — downloads work; new uploads to S3 need writes enabled (an approved decision).

## Troubleshooting
- `aws:start` says authorization expired → approval/re-arm needed (by design).
- Site not loading → `npm run aws:status`; reconnect `npm run aws:connect`; SSM requires your AWS login.
- Slow first answer (≈70 s) → run `npm run aws:warmup` after starting.
- Admin page detail → the user must have role `admin` in the EC2 database.
