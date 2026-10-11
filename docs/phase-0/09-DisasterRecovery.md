# NimbusVault — Disaster Recovery Design Document

| Field | Value |
|---|---|
| Document | Phase 0 · 09 — Disaster Recovery Design |
| Principle | Plan for failure; automate recovery; test regularly |
| Version | 1.0 |

---

## 1. Recovery Objectives

| Metric | Target | Measurement |
|---|---|---|
| **RPO (Recovery Point Objective)** | ≤ 15 minutes | Max data loss |
| **RTO (Recovery Time Objective)** | ≤ 1 hour | Time to restore service |
| **RTA (Recovery Time Actual)** | ≤ 4 hours | Verified by drill |

---

## 2. Backup Strategy

### 2.1 PostgreSQL

| Backup Type | Frequency | Retention | Storage |
|---|---|---|---|
| **Automated Snapshots** | Daily (03:00 UTC) | 30 days | RDS (cross-region copy) |
| **Point-in-Time Recovery (PITR)** | Continuous (WAL) | 7 days | RDS |
| **Manual Pre-Migration** | Before each production migration | 90 days | S3 (separate bucket) |

**Verification:** Monthly `pg_restore` to staging; validate row counts and foreign keys.

### 2.2 Redis

| Data Type | Backup Method | Frequency | Retention |
|---|---|---|---|
| **Rate Limits / Denylist** | None (rebuildable) | N/A | N/A |
| **Cache** | None (rebuildable) | N/A | N/A |
| **Queue Jobs** | BullMQ persists to Redis; RDB snapshots | Every 60 min | 7 days |
| **Session Data** | Redis RDB | Every 60 min | 7 days |

**Note:** Redis data is ephemeral/rebuildable except queue jobs. RDB snapshots to S3.

### 2.3 S3 (File Storage)

| Feature | Configuration |
|---|---|
| **Versioning** | Enabled (all objects) |
| **Cross-Region Replication (CRR)** | To secondary region (us-west-2) |
| **Lifecycle** | Incomplete MPU → 7 days; Trash → 30 days; Non-current versions → 90 days → Glacier |
| **Object Lock** | Compliance mode for legal hold (Phase 3+) |

**RPO for S3:** Near-zero (CRR is asynchronous but typically <15 min).
**RTO for S3:** Near-zero (DNS failover to replica bucket).

### 2.4 Configuration & Secrets

| Item | Backup Method |
|---|---|
| **Git Repository** | GitHub (primary) + mirror to GitLab |
| **Docker Images** | ECR / Docker Hub (immutable tags) |
| **Secrets** | AWS Secrets Manager (automatic rotation) + encrypted `.env.example` in repo |
| **IAM Policies** | AWS Config snapshots daily |

---

## 3. Recovery Procedures

### 3.1 Scenario: Database Primary Failure

**Detection:** Health check fails, ALB marks targets unhealthy
**Automatic Failover:** RDS Multi-AZ → standby promoted (typically <60s)
**Application Action:** Connection pool reconnects; in-flight requests retry
**RTO:** <2 minutes

### 3.2 Scenario: Database Corruption / Data Loss

**Detection:** Integrity check fails, or manual report
**Steps:**
1. Stop traffic (ALB drain + maintenance mode)
2. Identify last good snapshot (PITR or daily)
3. Restore to new instance: `aws rds restore-db-instance-to-point-in-time`
4. Update DNS / connection strings
5. Run integrity checks (row counts, FK validation)
6. Replay WAL if PITR used
7. Resume traffic
**RTO:** ≤ 1 hour (tested monthly)

### 3.3 Scenario: Region-Wide Outage

**Detection:** CloudWatch alarms, AWS Health Dashboard
**Failover:**
1. Update Route53 to secondary region (TTL 60s)
2. Promote S3 CRR bucket (if not automatic)
3. Launch EC2 from AMI in secondary region
4. Restore DB from cross-region snapshot
5. Update secrets / connection strings
5. Validate health checks
**RTO:** ≤ 4 hours (manual steps required)

### 3.4 Scenario: Accidental Deletion (User/Files)

**Detection:** User report or audit log alert
**Recovery:**
- **Soft-deleted (≤30 days):** `POST /files/:id/restore` or `POST /folders/:id/restore`
- **Hard-deleted / Purged:** Restore from S3 version + DB snapshot (RTO ≤ 1 hour)
- **Account Deletion:** Anonymized PII; activity logs retained with NULL user_id

### 3.5 Scenario: S3 Bucket Compromise

**Detection:** Unusual access patterns, CloudTrail alerts
**Response:**
1. Revoke all presigned URLs (denylist bucket policy)
2. Enable Object Lock (Compliance mode)
3. Restore from CRR replica or version history
3. Rotate IAM keys, investigate access logs
**RTO:** ≤ 2 hours

---

## 4. Backup Validation & Drills

### 4.1 Monthly Restore Drill (Automated)

```bash
#!/bin/bash
# Runs in CI/CD pipeline monthly
# 1. Create temporary RDS instance from latest snapshot
# 2. Run schema validation (prisma migrate diff)
# 3. Verify row counts on critical tables
# 4. Verify foreign key integrity
# 5. Clean up
```

**Success Criteria:**
- Restore completes <30 min
- Zero schema drift
- Row counts within 1% of production
- Zero FK violations

### 4.2 Quarterly Full DR Drill (Manual)

**Scope:** Region failover simulation
**Participants:** All team members
**Steps:**
1. Announce drill (no production impact)
2. Simulate primary region loss
3. Execute failover to secondary
4. Validate all user flows (register, upload, share, AI query)
5. Failback to primary
6. Document RTA, issues, improvements

**Evidence Collected:**
- Timestamped screenshots of each step
- RTA measurement
- Issues encountered + fixes
- Updated runbooks

---

## 5. Data Integrity Verification

### 5.1 Continuous Checks

| Check | Frequency | Method |
|---|---|---|
| **S3 Object Existence** | Nightly | `HEAD` on sample of READY files; alert on 404 |
| **Checksum Verification** | Weekly | Re-compute SHA-256 on sample; compare to `checksum_sha256` |
| **Orphaned Objects** | Nightly | List S3 objects without READY DB row → delete |
| **Quota Consistency** | On every write | Atomic conditional UPDATE (see Database doc §5) |
| **FK Integrity** | Monthly | `pg_dump --schema-only` + custom validator |

### 5.2 Reconciliation Jobs

| Job | Schedule | Action |
|---|---|---|
| **Orphan Cleanup** | Daily 04:00 | Delete S3 objects without READY file row (age > 24h) |
| **Trash Purge** | Daily 03:30 | Hard-delete files/folders with `deleted_at < now()-30d` |
| **Share Link Expiry** | Hourly | Mark expired links `EXPIRED`; prune >90d |
| **Session Cleanup** | Daily 04:30 | Revoke sessions inactive >30d |

---

## 5. Security Incident Recovery

| Incident | Immediate Action | Recovery |
|---|---|---|
| **Credential Leak** | Rotate keys (IAM, DB, JWT, LLM); revoke all sessions | Audit CloudTrail; force password reset |
| **Token Reuse Attack** | Revoke token family; force re-login | Notify user; review IP/device |
| **Cross-Tenant Access** | Alert + block offending IP/user | Root cause analysis; patch isolation layer |
| **Ransomware on S3** | Enable Object Lock; revoke presigned URLs | Restore from versioned objects / CRR |

---

## 5. Runbook Template

Every runbook follows this structure:

```markdown
# Runbook: [Incident Type]

## Symptoms
- What alerts fire
- What users report

## Diagnosis
- Queries to run
- Logs to check
- Metrics to review

## Resolution Steps
1. Step 1 (with exact commands)
2. Step 2
...

## Verification
- Health checks to pass
- Metrics to normalize

## Post-Incident
- Postmortem due within 48h
- Action items with owners
```

---

## 6. Testing & Compliance

| Test | Frequency | Owner |
|---|---|---|
| **Automated Restore Test** | Monthly | M3 (Cloud) |
| **Full DR Drill** | Quarterly | All |
| **Backup Encryption Check** | Monthly | M3 |
| **Cross-Region Replication Lag** | Weekly | M3 |
| **Object Lock Compliance** | Monthly | M3 |

---

## 7. Compliance Mapping

| Requirement | Implementation |
|---|---|
| **GDPR Art. 32** | Encryption, pseudonymization, restore capability |
| **SOC 2 CC7.2** | Incident response plan, testing |
| **ISO 27001 A.17** | Business continuity, redundancy |
| **NIST 800-53 CP-9** | Backup, recovery, testing |

---

*Recovery is not a backup — it's a tested, documented, automated process.*