# Final academic report verification

Verified: November 27, 2026.

## Document and identity

PASS: 70 A4 pages; 19 chapters; six appendices; 20 editable TikZ diagrams; nine vector charts; 32 technical tables; 35 cited references. Sixteen screenshot views come from fifteen distinct genuine captures. Student names, roll numbers, supervisor and institution were preserved from the original 17-page proposal. The editable LaTeX variable `\SubmissionDate` is November 27, 2026, printed on the cover. No “To be confirmed” appears in the PDF.

## Compilation and layout

PASS: Tectonic 0.17.0+20260731 compiled the complete document. Every page was rendered, and page layouts were visually reviewed, including the revised charts, data dictionary, CVE table and code excerpts. Automated rendering checks reported zero layout flags. The compiler log contains no overfull boxes, undefined references or missing-character warnings. There are benign underfull-spacing and duplicate first-page anchor warnings; these do not prevent rendering or compilation.

## Source archive rebuild and integrity

PASS: The whitelisted source ZIP was extracted into a separate directory. Every SHA-256 entry in `evidence/source_manifest.json` matched before compilation. The extracted sources compiled independently to 70 pages with exactly the same extracted report text as the delivered PDF. Binary equality is not asserted because PDF build metadata can vary. The final ZIP includes this verification record; its manifest was refreshed after packaging. The manifest excludes itself to avoid recursive hashing.

## Evidence and limitations

The report uses repository source, retained test logs and sanitised result snapshots; the reporting task did not repeat the application tests. It records 460 passes across separately run suites, 54 SPA route/viewport checks, the 84-query retrieval corpus and the final 40-case Linux CPU AI evaluation. It does not represent these as independent holdout accuracy, production coverage or EC2 benchmarks.

Full EC2 provisioning and acceptance remain pending. Matched CPU/GPU and cold/warm Qwen comparisons, EC2 resource traces and new semantic/BM25/hybrid interface captures are absent and explicitly disclosed. Historical AWS rehearsal and read-only observations are labelled separately from local Linux tests. Residual image vulnerabilities are reported, including the PostgreSQL libxml2 finding. No signed institutional certificate or AWS console evidence was fabricated.

## Preservation and privacy

The ZIP contains report sources/assets only: no private databases, original personal documents, AWS credentials, cookies, model weights, container images or recovery backups. Textual packaged files were checked for AWS access-key patterns, private-key blocks and Windows user-directory references in LaTeX. Application source, original report, runtime, databases and backups were not changed or deleted by this reporting task. No AWS resource was provisioned or account upgraded for this report.

## Build instructions

See `README.md` and the included build scripts. For Overleaf, import the ZIP, select `NimbusVault_Final_Project_Report.tex` as the main document and XeLaTeX as compiler. The flattened alternative is also included; select only one main file.
