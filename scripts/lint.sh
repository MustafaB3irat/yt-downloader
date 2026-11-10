#!/bin/bash
# Lint everything: Python (ruff), JavaScript (syntax), JSON manifest, shell (shellcheck).
# Tools are optional; missing ones are skipped with a note.
set -u
cd "$(dirname "$0")/.." || exit 1
FAIL=0
run() { echo "› $*"; "$@" || FAIL=1; }

if command -v ruff >/dev/null; then run ruff check host scripts
elif command -v uvx >/dev/null; then run uvx ruff check host scripts
else echo "skip: ruff (brew install ruff)"; fi

if command -v node >/dev/null; then
  for f in extension/*.js; do run node --check "$f"; done
else echo "skip: node"; fi

run python3 -m json.tool extension/manifest.json >/dev/null

if command -v shellcheck >/dev/null; then run shellcheck install.sh uninstall.sh scripts/*.sh host/ytd-host
else echo "skip: shellcheck (brew install shellcheck)"; fi

if [ "$FAIL" -eq 0 ]; then echo "All checks passed."; else echo "Some checks failed."; fi
exit "$FAIL"
