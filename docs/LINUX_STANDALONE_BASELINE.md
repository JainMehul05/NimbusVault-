# Linux EC2 deployment baseline

The repository in `nimbus vault final` is the sole application source. Do not copy or mount CloudVault. This is a source baseline, not evidence of a completed Linux deployment.

## Native prerequisites

Install supported Node.js 20+, Docker Compose, uv/Python 3.13, and an official **Linux** Ollama build matching the EC2 architecture. Recreate `intelligence/.venv` on Linux using `intelligence/requirements.lock` and CPU PyTorch. Never copy Windows `node_modules`, Python venvs, DLLs, or `ollama.exe` to EC2. `npm start`, `npm stop`, and `npm run setup` fail explicitly on Linux until native service provisioning is performed.

## Data and configuration transfer

Transfer this source checkpoint, a validated PostgreSQL custom dump, a consistent `data/cloudvault.db` backup, and required `.runtime/cloud-{config,resources}.json` and vector fixture configuration through a private channel. Back up local secrets but rotate production JWT and service secrets. Provision production credentials through an EC2 IAM role or approved profile; never bake credentials into an image. S3 object bytes remain in the existing private bucket and are not included in local database backups.

The portable MiniLM cache is `.runtime/standalone-ai/embedding-cache`; its Hugging Face snapshot files must be materialized rather than absolute links. Qwen blobs/manifests are platform-independent: copy `.runtime/standalone-ai/models` and verify the recorded SHA256 manifest after transfer. Set `OLLAMA_MODELS` to its Linux absolute path. Install native Ollama separately; do not deploy `.runtime/standalone-ai/ollama` from Windows.

## Service plan

Run PostgreSQL with a persistent volume and restore a copy of the validated dump. Install workspace dependencies with `npm ci`, generate Prisma, build the backend/frontend, and apply reviewed migrations to the intended deployment database. Start native `ollama serve` on `127.0.0.1:11434` with `OLLAMA_NO_CLOUD=1`, `OLLAMA_NUM_PARALLEL=1`, and `OLLAMA_MAX_LOADED_MODELS=1`. Start `intelligence/.venv/bin/python -m uvicorn app.internal:app --host 127.0.0.1 --port 8101` from `intelligence`, then `node backend/dist/main.js` from the project root with its correct environment. Use systemd units with working directories and environment files, dependency ordering, restart policy and termination handling.

Keep intelligence and Ollama loopback-only; use the existing same-host boundary. The legacy `docker-compose.yml` is a separate LocalStack development stack and does **not** deploy the canonical intelligence/Qwen services. `compose.local.yml` supplies local PostgreSQL only. Neither is a complete production EC2 deployment.

Before public access, configure HTTPS/reverse proxy, secure cookies, the actual public frontend origin, production database connectivity, IAM permissions and firewall rules. Re-run offline embedding generation, scoped retrieval, multi-document generated Qwen answers with citations, authentication/revocation, read-only AWS probes, backup/restore, and clean service restart on Linux. Measure EC2 memory/latency before choosing instance capacity; local Windows benchmarks do not establish EC2 performance or cost.

No AWS resource creation, account upgrade, IAM change, provisioning or deployment is authorized by this document. Those are the next deployment task. Preserve the original recovery backup until Linux acceptance and a separately retained data backup are complete.
