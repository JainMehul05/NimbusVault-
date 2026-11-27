## Session B: startup repair and restart cycles
The old readiness failure was reproduced (exit 56 during API start) and fixed (`deployment/ec2-ready.sh`). Ordinary cycles 40 / 45 / 46 s; `aws:stop` 28 s with session closure; watchdog-initiated shutdown on expired authorization (34 s); external Scheduler stop of a running instance; the public URL returns 503 while stopped and works unchanged after restart.

---

# Graceful shutdown and restart on EC2

| Test (27 Nov 2026, UTC) | Result |
|---|---|
| API stopped (`compose stop -t 35 api`) 8 s into an active Qwen answer | stopped in **10.7 s**, exit 0, no OOM; log shows `Shutting down` + `AI_CANCELLED`; client received **HTTP 499** |
| Conversation consistency | conversation count unchanged (6 → 6): cancelled answer not saved as completed history |
| API restart | healthy; login, files and search preserved |
| Ollama stopped | answers labelled `extractive` with warning; search works; restarted healthy |
| Cloud operations paused | downloads 503 (clean), search and Qwen RAG still work from private index |
| Intelligence/API recreation (×3 for config/patches) | `up --wait` healthy each time; data volumes preserved |
| Full instance stop (`npm run aws:stop`) | OS shutdown ran `nimbusvault.service` stop (compose stop -t 35); instance `stopped` in 31 s |
| Instance start (`npm run aws:start`) | services auto-started by systemd; metadata firewall reapplied; healthy in 40 s; users, files, folders, permissions, conversations, embeddings, models persisted; no model re-download |
| Deadline across restart | absolute deadline re-armed at the same 13:20:30 UTC from the instance tag (cannot be extended by restarting) |

Bounds: API force-exit 30 s, cancel at 10 s; compose stop grace 35 s; systemd stop timeout 150 s; boot runtime limit 3 h 45 min; external stop schedule. Not separately tested on EC2: interruption during an active upload/extraction/embedding (uploads are single create-only PutObject with checksum verification, so a partial upload cannot be finalized; covered by existing backend tests).
