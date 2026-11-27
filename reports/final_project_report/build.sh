#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if command -v tectonic >/dev/null 2>&1; then
  tectonic --keep-logs NimbusVault_Final_Project_Report.tex
else
  latexmk -xelatex -interaction=nonstopmode -halt-on-error NimbusVault_Final_Project_Report.tex
fi
