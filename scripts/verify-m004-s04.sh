#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

DIAGNOSTICS_PATH="data/reviewed/m004-s02-bulk-latest.json"

run_phase() {
  local phase="$1"
  shift
  echo "==> M004/S04 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "M004/S04 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  }
}

run_phase "regenerate source/race coverage diagnostics" pnpm report:source-race-coverage -- --publication-diagnostics "${DIAGNOSTICS_PATH}"
run_phase "regenerate reviewed position coverage" pnpm review:coverage -- --bulk-diagnostics "${DIAGNOSTICS_PATH}"
run_phase "targeted M004 public comparison model tests" node --import tsx --test tests/data/m004-public-comparison.test.ts
run_phase "targeted M004 bulk publication tests" node --import tsx --test tests/extraction/m004-bulk-publish.test.ts
run_phase "public data validation" pnpm validate-data
run_phase "public route and data contract tests" pnpm test:data
run_phase "extraction loader/review integration tests" pnpm test:extraction
run_phase "typecheck" pnpm typecheck
run_phase "static export build" pnpm build
run_phase "M004/S04 static public route assertions" node scripts/assert-m004-s04-public-routes.mjs

echo "M004/S04 verification passed: repaired coverage artifacts, targeted M004 tests, data/extraction suites, typecheck, static export build, and representative M004 public route HTML assertions."
