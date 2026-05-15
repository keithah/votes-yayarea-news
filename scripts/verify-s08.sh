#!/usr/bin/env bash
set -euo pipefail

run_phase() {
  local phase="$1"
  shift
  echo "==> S08 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "S08 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  }
}

run_phase "public data validation" pnpm validate-data
run_phase "drill-down model and route tests" pnpm test:data
run_phase "typecheck" pnpm typecheck
run_phase "static export build" pnpm build
run_phase "entity, source, race-link, and disclosure export assertions" node scripts/assert-s08-export.mjs

echo "S08 verification passed: public data validation, data/model/route tests, typecheck, static export build, and entity/source/race-link/disclosure HTML assertions."
