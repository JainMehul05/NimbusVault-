# Official UCS503P template comparison and recovery

Template inspected: https://github.com/tiet-ucs503/ucs503p-202627odd-template at commit `2cd8dba362da1b5178d03fe04b4f499b41525436`. Its README specifies three separate LaTeX reports, application source in `code/`, documentation in `docs/`, and one journal directory per team member. Its complete tracked tree, workflow, MkDocs configuration, Makefile, pyproject, ignore rules, licence, sample journals and report conventions were inspected.

## Required structure

| Official requirement | NimbusVault preparation |
|---|---|
| `assets/` | Original TIET/template assets retained; used by the documentation build |
| `code/` | Complete published application, infrastructure, tests and launchers moved together in the isolated worktree |
| `docs/` | Technical documentation retained; academic navigation and path mapping added |
| `journals/` | Actual team identities from the original submission; missing historical entries disclosed; original sample journals separately preserved |
| `project-proposal/` | Genuine original PDF and LaTeX restored from Git objects, with a distinct later revision |
| `project-report-prototype-stage/` | Genuine original PDF and LaTeX restored byte-for-byte |
| `project-report-final/` | Existing genuine completed report package preserved; verified public/Groq final revision still required |
| MkDocs/Makefile/pyproject/workflow | Template conventions adapted to NimbusVault, portable tooling, actual `main` branch, journal/report navigation and history-preserving Pages artifacts |
| Licence/ignore rules | Original notices retained; no new blanket app licence asserted; runtime/model/credential protections maintained |

## Exact historical recovery

Original hyphenated proposal recovered from `86264bd44be222dd7ba1d1fce63c16ca266925f2`:

- `project-proposal/NimbusVault_Project_Proposal.pdf`
- `project-proposal/main (3).tex`

Original prototype recovered from the earlier default branch `06bccdfafcecd75316a70b3e6c39018205d5fd65`:

- `project-report-prototype-stage/NimbusVault_Project_report.pdf`
- `project-report-prototype-stage/NimbusVault_Project_report.tex`

A later original proposal revision from that same earlier default branch is preserved separately under `project-proposal/revisions/2026-10-13/`, retaining its original PDF/LaTeX names. The history contains the same PDF blob under the original proposal and prototype filenames; this duplication was not silently corrected or regenerated. All recovered file hashes, historical paths, commits and sizes are recorded in [the recovery manifest](academic-recovery-manifest.json).

No separate supporting figures, bibliography or class files were present beside those recovered originals. Their LaTeX sources contain their formatting/diagrams. Original PDFs opened successfully: proposal 17 pages, prototype 17 pages, later proposal revision 14 pages. Historical source/PDF pairs are preserved as committed; a new rendering is not substituted for the original submission.

## Journal recovery result

All reachable local/remote branches, tags, recovery references and historical journal paths were inspected. The only four original journal files belong to the template's Bhanurekha/Vidya examples. They were retained byte-for-byte under `journals/template-examples/` with their original authorship and formatting; they are not NimbusVault team contributions. No genuine authored entries for Saras, Mehul Jain or Mansimar Kaur were found. Their individual pages state this gap and do not invent dates or work assignments.

## Publication status

Current main and local recovery references were recorded before restructuring. Preparation occurs on `codex/university-template-20261127` in a separate worktree; the active application and concurrent Groq files are not moved or edited. No AWS resource is modified. The university-layout branch is not pushed until the completed Groq verification/checkpoint and final-report revision are available.

The final verification must include exact restoration hashes, layout completeness, focused application builds/configuration checks, MkDocs/site links, original-PDF inspection, final-PDF recompilation, secret scans, a normal push and a fresh remote-tree/clone comparison. Preparation alone is not proof of final publication.

## Focused preparation checks completed

The isolated `code/` installed dependencies and generated its own Prisma client, then built the backend and frontend successfully. Infrastructure tests passed 22 cases; AWS launcher safety passed 10; two mocked Docker readiness tests passed. All three Compose files validated without starting containers. Script syntax checks passed. MkDocs built with root assets, individual journal status pages and all three report download areas; 3,898 generated internal links had no missing targets. All ten restored historical file hashes matched. A prepared-source scan found no credential/private-runtime artefacts. These are focused preparation checks, not a fresh full application/AWS/AI benchmark run.

The recovery search also inspected the known private backup ZIP and relevant Downloads project names without finding additional original journal/submission files. No extra external figures or bibliography references appear in the recovered historical LaTeX sources. Genuine authored student journals remain unrecovered; no substitute entries were fabricated.
