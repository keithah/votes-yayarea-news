#!/usr/bin/env bash
set -euo pipefail

run_phase() {
  local phase="$1"
  shift
  echo "==> S06 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "S06 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  }
}

run_phase "public data validation" pnpm validate-data
run_phase "matrix model and route tests" pnpm test:data
run_phase "typecheck" pnpm typecheck
run_phase "static export build" pnpm build
run_phase "static export HTML assertions" node scripts/assert-s06-export.mjs

echo "S06 verification passed: public data validation, matrix model/route tests, typecheck, static export build, and mayor matrix HTML assertions."
