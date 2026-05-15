#!/usr/bin/env bash
set -euo pipefail

run_phase() {
  local phase="$1"
  shift
  echo "==> S04 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "S04 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  }
}

run_phase "public data validation" pnpm validate-data
run_phase "reviewed position coverage" pnpm review:coverage
run_phase "public route and copy contract tests" pnpm test:data
run_phase "extraction loader/review integration tests" pnpm test:extraction
run_phase "typecheck" pnpm typecheck
run_phase "static export build" pnpm build
run_phase "static export public route assertions" node scripts/assert-s04-public-routes.mjs

echo "S04 verification passed: real public route/copy polish, reviewed coverage, loader integration, typecheck, static export build, and representative public HTML safety assertions."
