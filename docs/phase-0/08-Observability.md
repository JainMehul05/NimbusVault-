# NimbusVault — Observability Design Document

| Field | Value |
|---|---|
| Document | Phase 0 · 08 — Observability Design |
| Principle | Observability is not optional — it's the nervous system of the system |
| Version | 1.0 |

---

## 1. Observability Pillars

| Pillar | Purpose | Tools |
|---|---|---|
| **Logging** | What happened, when, with what context | Pino (Node) / structlog (Python) → stdout → CloudWatch / OpenSearch |
| **Metrics** | How much, how fast, how many | Prometheus + Grafana |
| **Tracing** | Where did the request go, how long at each step | OpenTelemetry → Jaeger / Tempo |
| **Alerting** | When to wake up the team | Prometheus Alertmanager → PagerDuty / Slack |

---

## 2. Structured Logging

### 2.1 Log Format (JSON Lines)

```json
{
  "timestamp": "2026-08-23T10:00:00.123Z",
  "level": "info",
  "service": "backend-api",
  "requestId": "req_01J9ZK...",
  "userId": "u_7c9...",
  "message": "File upload finalized",
  "context": {
    "fileId": "f_51b...",
    "sizeBytes": 2411724,
    "durationMs": 45
  }
}
```

### 2.2 Required Fields

| Field | Description | Required |
|---|---|---|
| `timestamp` | ISO-8601 UTC | Yes |
| `level` | debug/info/warn/error/fatal | Yes |
| `service` | Service name (backend-api, ai-service, etc.) | Yes |
| `requestId` | UUID v4, propagated end-to-end | Yes |
| `userId` | Authenticated user (if applicable) | Conditional |
| `message` | Human-readable summary | Yes |
| `context` | Structured key-value pairs | Yes |
| `error` | `{ message, stack, code }` | On error |

### 2.3 Log Levels

| Level | When to Use |
|---|---|
| **debug** | Detailed diagnostic info (SQL queries, cache hits, queue operations) |
| **info** | Business events (login, upload, share, AI query) |
| **warn** | Recoverable issues (rate limit hit, slow query, retry) |
| **error** | Unrecoverable in current request (DB error, S3 failure, LLM timeout) |
| **fatal** | Process cannot continue (config missing, DB unreachable) |

### 2.4 Sampling

- **Debug logs:** Sampled at 10% in production (configurable)
- **Request/Response logs:** Sampled at 1% for high-volume endpoints
- **Error logs:** Always 100%

---

## 3. Metrics

### 3.1 RED Metrics (per endpoint)

| Metric | Type | Description |
|---|---|---|
| **Rate** | Counter | Requests per second |
| **Errors** | Counter | 5xx + 4xx (client errors tracked separately) |
| **Duration** | Histogram | Latency in milliseconds (p50, p90, p95, p99) |

### 3.2 USE Metrics (per resource)

| Resource | Metrics |
|---|---|
| **CPU** | Usage %, saturation |
| **Memory** | Usage %, RSS, heap |
| **Disk** | Usage %, IOPS, latency |
| **Network** | Throughput, errors, retransmits |
| **Database** | Connections active/idle, query duration, replication lag |
| **Redis** | Memory %, hit rate, connection count |
| **Queue** | Depth, processing rate, job duration, dead-letter count |

### 3.3 Business Metrics

| Metric | Type | Alert Threshold |
|---|---|---|
| Active users (DAU/MAU) | Gauge | — |
| Upload success rate | Counter | <99.5% → alert |
| AI query latency p95 | Histogram | >8s → alert |
| Queue depth | Gauge | >1000 → alert |
| Dead-letter queue size | Gauge | >0 → alert |
| Token reuse detections | Counter | >0 → immediate alert |
| Cross-tenant access attempts | Counter | >0 → immediate alert |

---

## 4. Distributed Tracing

### 4.1 Trace Context Propagation

- **W3C TraceContext** headers: `traceparent`, `tracestate`
- **Generated at:** API Gateway / first middleware
- **Propagated via:** HTTP headers (`traceparent`, `tracestate`), queue message headers, gRPC metadata

### 4.2 Span Attributes (Required)

| Attribute | Description |
|---|---|
| `service.name` | Service name |
| `span.kind` | server/client/producer/consumer |
| `http.method` / `http.route` | For HTTP spans |
| `db.system` / `db.statement` | For DB spans |
| `messaging.system` / `messaging.destination` | For queue spans |
| `error` / `exception.*` | On error spans |

### 4.3 Key Traces

| Flow | Services Involved |
|---|---|
| **Upload** | API → S3 (async) → DB → Queue → AI Worker → ChromaDB |
| **RAG Query** | API → AI Service → ChromaDB → LLM |
| **Share Redemption** | API → DB → S3 (presign) |

---

## 5. Alerting

### 5.1 Alert Routing

| Severity | Channel | Response Time |
|---|---|---|
| **Critical (P1)** | PagerDuty + Slack #alerts-critical | 5 min |
| **Warning (P2)** | Slack #alerts-warning | 30 min |
| **Info (P3)** | Slack #alerts-info | Next business day |

### 5.2 Core Alerts

| Alert | Condition | Severity | Runbook |
|---|---|---|---|
| **API Error Rate** | 5xx > 1% for 5m | Critical | Check logs, check dependencies |
| **API Latency p95** | >300ms for 10m | Warning | Check DB, Redis, queue |
| **Queue Depth** | >1000 jobs for 10m | Warning | Add workers, check DLQ |
| **Dead Letter Queue** | Size > 0 | Critical | Inspect, replay or fix |
| **DB Connections** | >80% pool used | Warning | Check leaks, scale pool |
| **Replication Lag** | >1s for 5m | Warning | Check replica health |
| **Token Reuse Detected** | Count > 0 | Critical | Security incident |
| **Cross-Tenant Access** | Count > 0 | Critical | Security incident |
| **AI Cost Daily** | >$4/day | Warning | Check usage, cap if needed |
| **Disk Space** | >80% | Warning | Cleanup, expand |
| **Certificate Expiry** | <30 days | Warning | Renew |

### 5.3 Alert Suppression

- **Maintenance Windows:** Suppress non-critical alerts during scheduled maintenance
- **Flapping Detection:** Auto-suppress alerts that fire >3 times in 10m
- **Dependencies:** If DB down, suppress API latency alerts

---

## 6. Dashboards

### 6.1 Required Dashboards

| Dashboard | Panels |
|---|---|
| **System Overview** | Request rate, error rate, latency p95, active users, queue depth |
| **API Performance** | Per-endpoint RED metrics, percentiles |
| **Database** | Connections, query latency, cache hit ratio, replication lag |
| **Queue Health** | Depth, processing rate, job duration, DLQ size, retries |
| **AI Service** | Extraction/embedding duration, RAG latency, token usage, cost |
| **Security** | Failed logins, token reuse, cross-tenant attempts, rate limit hits |
| **Cost** | Daily spend by service, token usage, projected monthly |

---

## 7. Health Checks

### 7.1 Endpoint Types

| Endpoint | Purpose | Dependencies Checked |
|---|---|---|
| `GET /health` | Liveness (k8s/ALB) | Process up |
| `GET /health/ready` | Readiness (traffic routing) | DB, Redis, S3, Queue |

### 7.2 Readiness Check Implementation

```typescript
async function readinessCheck() {
  const checks = await Promise.allSettled([
    db.$queryRaw`SELECT 1`,           // DB
    redis.ping(),                      // Redis
    s3.headBucket({ Bucket }).promise(), // S3
    queue.client.ping(),               // Redis (queue)
  ]);

  const failed = checks.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    return { status: 'degraded', checks: failed.map(f => f.reason) };
  }
  return { status: 'ready' };
}
```

---

## 8. Log Retention & Storage

| Log Type | Retention | Storage |
|---|---|---|
| Application (JSON) | 30 days hot, 1 year cold | CloudWatch / OpenSearch |
| Audit (activity_logs) | 12 months | PostgreSQL (partitioned) |
| Access (ALB/CloudFront) | 90 days | S3 (immutable) |
| Traces | 7 days hot, 30 days cold | Tempo / Jaeger |
| Metrics | 13 months | Prometheus (TSDB) |

---

## 8. Incident Response Integration

- **Alert → Runbook Link:** Every alert includes a link to the runbook
- **Postmortem Template:** Required for P1 incidents within 48h
- **Blameless Culture:** Focus on system, not people
- **Action Items:** Tracked in GitHub Issues with `postmortem` label

---

*Observability is the difference between guessing and knowing.*