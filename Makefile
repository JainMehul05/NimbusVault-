# Adapted from the official UCS503P scaffold; no machine-specific Conda/zsh dependency.
SHELL := /bin/sh
UV ?= uv
ADDR ?= 127.0.0.1:8000
.PHONY: docs docserve docbuild app-build app-lint

docs: docserve

docserve:
	$(UV) run --locked --extra docs mkdocs serve -a $(ADDR)

docbuild:
	$(UV) run --locked --extra docs mkdocs build --clean

app-build:
	cd code && npm run build

app-lint:
	cd code && npm run lint
