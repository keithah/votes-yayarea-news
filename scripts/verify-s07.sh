#!/usr/bin/env bash
set -euo pipefail

run_phase() {
  local phase="$1"
  shift
  echo "==> S07 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "S07 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  }
}

run_phase "public data validation" pnpm validate-data
run_phase "receipt, summary, matrix, and route tests" pnpm test:data
run_phase "typecheck" pnpm typecheck
run_phase "static export build" pnpm build
run_phase "receipt, reviewed-summary, and disclosure export assertions" node scripts/assert-s07-export.mjs
run_phase "local Pages static HTTP smoke" node scripts/smoke-s07-static-export.mjs --json-out data/launch/s07-static-smoke.json
run_phase "launch evidence and Pages workflow proof" node scripts/record-s07-launch-verification.mjs

echo "S07 verification passed: public data validation, data/model/route tests, typecheck, static export build, export assertions, local Pages static HTTP smoke, and launch evidence recording."
