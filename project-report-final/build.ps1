$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
  if (Get-Command tectonic -ErrorAction SilentlyContinue) {
    & tectonic --keep-logs NimbusVault_Final_Project_Report.tex
  } elseif (Get-Command latexmk -ErrorAction SilentlyContinue) {
    & latexmk -xelatex -interaction=nonstopmode -halt-on-error NimbusVault_Final_Project_Report.tex
  } else { throw 'Install free Tectonic or TeX Live/MiKTeX with latexmk, or import the complete ZIP into Overleaf.' }
  if ($LASTEXITCODE -ne 0) { throw 'LaTeX compilation failed; inspect the compiler log.' }
} finally { Pop-Location }
