# CI/CD

## `ci.yml`: every push and pull request

| Job | What it proves |
|---|---|
| Backend | Upgrade of a populated older database, fresh install, no schema drift, lint, types, all tests against real PostgreSQL 16 + pgvector and LocalStack, production build starts and stops cleanly, insecure production settings are refused |
| Frontend | Lint, types, component tests, production build |
| End-to-end | Chromium against the production builds with real PostgreSQL, LocalStack and MiniLM embeddings, at 390, 768 and 1440 px |
| Infrastructure | Types, unit tests, synthesis of every variant (fails on unacknowledged security findings), cfn-lint |
| Containers | The Compose stack builds, becomes healthy, passes a smoke test, survives recreation; images are unprivileged, the model loads with no network, no fixable critical vulnerabilities |
| Security | No high/critical advisories in shipped dependencies, no committed credentials |

## `deploy.yml`: manual, gated

Runs only when started by hand for an environment, and stops at a gate unless that GitHub environment defines `AWS_DEPLOY_ROLE_ARN` and `AWS_REGION`. It then runs the whole of `ci.yml`, assumes the role through OIDC, pushes an image tagged with the commit, and runs the same `deploy.sh`/`verify.sh` described in the deployment guide.

**Rollback**: run it again with `image_tag` set to an earlier commit SHA. ECS also rolls back by itself when new tasks fail their health checks.

Deployment through GitHub Actions is **DEFERRED** (no AWS account). `deploy.yml` has been linted, never executed past the gate.
