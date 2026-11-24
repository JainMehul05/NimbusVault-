# Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Refusing to run tests against database` | Protection for your data. `npm run test:prepare --workspace=backend`, or set `DATABASE_URL` to a test database |
| `extension "vector" is not available` | Use `pgvector/pgvector:pg16`, not plain `postgres` |
| API 404 on every route | `API_PREFIX` should be `v1` |
| Signed out on every reload | API and app on different sites: use the proxy, or `COOKIE_SAMESITE=none` with HTTPS |
| `CSRF_REJECTED` on refresh | Send `X-Requested-With: XMLHttpRequest`; check `FRONTEND_URL` |
| Download link host not found | Set `S3_PUBLIC_ENDPOINT` to an address the browser can reach |
| `File not found in storage` after restarting LocalStack | Community LocalStack does not persist objects |
| `Refusing to start` | Read the listed configuration problems |
| Files stay "Queued" | No worker: check `AI_WORKER_ENABLED`, the worker's logs, and `GET /ai/status` |
| "No AI" on a scanned PDF | `AI_OCR_ENABLED=true`, then Document insights → Re-index |
| Anthropic returns 400 about `temperature` | Fixed in this release; update |
| `npm warn allow-scripts` | npm 11 skips install scripts; run `npm run db:generate` once |
| Prisma `EPERM` on Windows during generate | Stop running backends first |
| `cdk synth` fails with AwsSolutions errors | Fix the finding or accept it with a reason (`accept` in `infra/lib`) |
