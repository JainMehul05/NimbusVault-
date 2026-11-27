# One-click launcher integration and verification

November 27, 2026. This change is integrated with the existing local/EC2 controllers and ongoing public deployment work; it does not provision a second deployment.

## Local launchers — verified live

`Start NimbusVault.bat`, `Stop NimbusVault.bat`, and `NimbusVault Status.bat` were invoked through cmd.exe/Windows PowerShell 5.1 in the ordinary hp user session (medium integrity, no administrator elevation), from the actual project directory containing spaces. Startup opened the local website through the default-browser shell association. A fresh startup completed database/backend/private intelligence/storage/frontend checks, a fresh MiniLM embedding and a Qwen runtime readiness generation. Repeated Start returned success without restarting the running services. Stop drained the Express API and Uvicorn intelligence service through token-protected loopback controls, unloaded Qwen allocations, stopped only the compose.local.yml database and verified stopped state. Repeated Stop succeeded. A subsequent full Start and warmup also succeeded. Status reported live MiniLM loaded and Qwen loaded, with historical warmup timestamps labelled separately.

The existing pre-change process session was migrated once before final acceptance; subsequent cycles used verified graceful controls. New stop code refuses force termination of API/intelligence services without a verified graceful control channel. Ollama model allocations unload before its owned Windows server process is stopped. Shutdown preserves volumes, documents and conversation databases.

Before/after Docker running-container inventories matched after excluding the intentionally stopped `nimbusvault-final-db`; the other NimbusVault Linux rehearsal stack, test S3 and unrelated projects remained running. No global Docker stop/down/prune or volume deletion was used.

## AWS launchers — safe paths verified; public acceptance pending

`Start NimbusVault AWS.bat` was invoked in the normal user environment. It authenticated and checked the existing approved instance manifest, then correctly returned failure before any paid startup because the manifest currently has no public CloudFront HTTPS URL. `Stop NimbusVault AWS.bat` was invoked while that instance was already stopped; it verified `stopped` and performed no mutation. Status read the actual instance state, active FREE plan, live credit balance and host deadline. The instance was subsequently observed running as part of concurrent deployment work; this launcher test did not start or stop that session.

Live AWS public startup/warmup/graceful-stop acceptance is **not yet complete**. After the ongoing public deployment writes `public_url` to `.runtime/aws-deployment/approved-instance.json`, test Start with explicit bounded authorization, verify the public site/AI, then Stop and verify EC2 stopped. Do not stop another active authorized deployment session just to run launcher tests.

The wrapper uses the existing `aws-runtime.py` functions for identity/instance ownership, FREE/ACTIVE plan, USD10 reserve, explicit YES, maximum four-hour authorization, fresh deadline/credit tags and external Scheduler stop. The host readiness step verifies the runtime timer, absolute-deadline timer and credit-watchdog timer are active before warmup. Running sessions require matching unexpired authorization and an enabled correctly targeted external stop schedule, and are never silently extended. Failed post-start host/AI/public checks request a normal owned-instance stop. Public health requires certificate-verified HTTPS, genuine EC2 NimbusVault health identity and the frontend HTML. Stop first requests the existing systemd/Compose drain, then a normal EC2 OS shutdown and waiter-confirmed stopped state. It never uses Force, SkipOsShutdown, termination, account upgrades or infrastructure provisioning.

## Regression checks

- Nine Python safety tests passed: missing/private public URL, HTTPS/AWS hostname restrictions, transition handling, already-stopped idempotence, no confirmation bypass, no expired-session extension, warmup-failure stop and expired deadline handling. Run `intelligence\.venv\Scripts\python.exe scripts/test-launcher-aws.py`.
- Two isolated Windows PowerShell Docker orchestration tests passed: hidden Docker Desktop start/readiness retries and bounded timeout. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-launcher-docker.ps1`.
- Token-free shutdown requests to both local control listeners returned HTTP 403 and left the application running.
- PowerShell parsing, Node syntax and Python compilation passed for the new helpers.
- Five desktop shortcuts were created with explicit user approval, pointing to the batch files and setting the project working directory.

A real cold launch of Docker Desktop was **not** exercised by stopping the running engine: that would interrupt unrelated Docker projects. The retry/timeout paths were tested with isolated mocks, and the installed per-user Docker Desktop executable was located. Initial Docker/WSL installation, sign-in and licensing dialogs still require normal user completion.

## Files and advanced use

All five batch files locate the project with `%~dp0`, quote paths, disable delayed expansion, preserve exit codes and keep the result window visible. Local and AWS launch operations have separate exclusive lock files to prevent competing same-target starts/stops. Control secrets live in an ignored directory restricted to the current Windows user. Existing npm commands and application credentials are preserved; no credentials are embedded in batch files or desktop shortcuts.

The new source files are `scripts/launcher.ps1`, `scripts/launcher-aws.py`, `scripts/local-api-host.cjs`, `scripts/local-intelligence-host.py`, `deployment/launcher-ready.sh`, `deployment/launcher-stop.sh` and the two focused regression scripts. Existing Windows start/stop scripts now support the graceful service hosts. See the README and university demonstration guide for the simplified procedure.
