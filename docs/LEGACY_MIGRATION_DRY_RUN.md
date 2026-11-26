# Legacy migration dry run

No original owner was confirmed. The safe selected action is **preserve without active import**. The first registrant does not receive legacy ownership and administrator status does not grant it.

| Preserved data | Verified initial and final rows | Proposed owner / ID action |
|---|---:|---|
| Files / original keys | 12 | Owner unassigned; keep keys/IDs unchanged |
| Chunks / compatible vectors | 61 | Preserve model, IDs and float32 payloads; no re-embedding |
| Conversations | 21 | No owner confirmed; preserve privately, do not publish |
| Exchanges | 32 | Keep associated with preserved conversations only |

`PRESERVATION_LOCAL_AUDIT.json` compares every row of these tables to the consistent initial backup and verifies unchanged original configuration and clean donor Git tree. `PRESERVATION_CLOUD_AUDIT.json` verifies existing original keys and vector payloads read-only. Neither report exports private contents. Private backups contain the actual mapping material; the public report contains counts only.

There is no automatic apply action. A future owner-authorized migration must explicitly map each legacy file/conversation to confirmed account IDs in a separate reviewed plan, check collisions and model compatibility, preserve original S3 keys, then populate only the independent final runtime. Dry-run totals and hashes must match before applying. Do not replay uploads or silently assign old conversations. Back up both final databases immediately before applying, and roll back using matching snapshots if validation fails.
