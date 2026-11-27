> Publication note: this completed report is the pre-deployment November 27, 2026 evidence snapshot. Current EC2/public-host status is documented in ../../docs/AWS_FINAL_DEPLOYMENT_REPORT.md and ../../docs/PUBLIC_DEPLOYMENT_GUIDE.md. No report build environment or raw private evidence is distributed.

# NimbusVault final academic report

Submission date: **November 27, 2026**, set by the editable `\SubmissionDate` variable near the top of the main LaTeX file. Student, supervisor and university details match the original proposal.

## Build

The verified compiler is **Tectonic 0.17.0+20260731**, available free of charge. From this directory:

```powershell
./build.ps1
```

Or run `tectonic --keep-logs NimbusVault_Final_Project_Report.tex`.
Tectonic resolves bibliography/cross-reference passes automatically. Its first build may download TeX support files; no shell escape is required. With TeX Live/MiKTeX, `latexmk -xelatex -interaction=nonstopmode -halt-on-error NimbusVault_Final_Project_Report.tex` is an alternative. Do not compile from the application's root directory.

## Overleaf

Upload the complete source ZIP as a new project. Select `NimbusVault_Final_Project_Report.tex` as the main file, XeLaTeX as compiler, and a recent TeX Live version. Keep relative folders intact. Edit the submission-date variable or individual chapter files, then recompile. `NimbusVault_Final_Project_Report_Flattened.tex` is also supplied: it contains all chapter/appendix text in one file while retaining relative diagram/image and bibliography assets. Select only one main file.

## Editable source

The 19 chapters, technical appendices, `references.bib`, twenty TikZ diagram sources, vector chart PDFs and selected screenshots are included. Chart input is `evidence/evaluation_summary.json`; `tools/regenerate_charts.py` recreates charts with Matplotlib. TikZ sources can be edited directly; the optional diagram generator is retained. Original proposal vector figure crops are preserved under `figures/original_proposal` as historical reference assets, not current implementation evidence.

## Evidence and scope

The report distinguishes the October proposal, verified Windows application with historical AWS rehearsal, local Linux CPU verification, and **EC2 deployment still pending explicit approval/acceptance**. A local Docker run is never labelled an EC2 result. The 460 test passes come from separate suites; 54 browser observations are SPA route/viewport checks. The search corpus was used during development. No production coverage percentage, public HTTPS site, independent load test, cloud-host performance chart or universal 100% accuracy is claimed.

Existing genuine application captures are reused. Three public-page captures render the compiled frontend without starting a backend; captions identify that boundary. Cloud evidence is a historical application diagnostic snapshot, not a newly captured AWS console session. New semantic/BM25/hybrid UI screenshots could not be captured because the application/Docker were stopped; quantitative evidence and the actual source are used instead. No cloud instance was started for reporting.

The image scan contains 23 distinct HIGH/CRITICAL CVE identifiers across four images. One PostgreSQL libxml2 finding remains scanner-critical, with a different Debian minor/no-stable-fix assessment. No absence-of-vulnerabilities claim is made. Detailed sanitised evidence is included.

No prescribed signed institutional certificate was supplied, so none is fabricated. An unsigned authorship area is included; an institution-mandated certificate can be added through its normal approval process.

## Privacy and reproducibility

The source package excludes private databases, original personal documents, credentials, cookies, model weights, Docker images, recovery backups and build environments. Only selected safe screenshot assets and sanitised metric/security snapshots are packaged. Build working files remain outside the ZIP. The original proposal PDF is not overwritten.

`VERIFICATION_REPORT.md` records final page/figure counts, compilation and archive-rebuild checks. Recompilation is verified by matching extracted report text and page count; bit-for-bit PDF equality across different TeX engines/distributions is not promised.
