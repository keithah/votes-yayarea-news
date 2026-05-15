#!/usr/bin/env bash
set -euo pipefail

run_phase() {
  local phase="$1"
  shift
  echo "==> S05 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "S05 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  }
}

run_phase "public data validation" pnpm validate-data
run_phase "reviewed position coverage" pnpm review:coverage
run_phase "data, launch artifact, route/link, leakage, and browser evidence tests" pnpm test:data
run_phase "extraction loader and review integration tests" pnpm test:extraction
run_phase "typecheck" pnpm typecheck
run_phase "real 2026 static export build" pnpm build
run_phase "S05 launch export route, link, and leakage assertions" node scripts/assert-s05-launch-export.mjs
run_phase "production-like local static export smoke" node scripts/smoke-s05-static-export.mjs --json-out data/launch/s05-static-smoke.json
run_phase "desktop and mobile launch gate recording" node scripts/record-s05-launch-verification.mjs --smoke-json-file data/launch/s05-static-smoke.json --browser-json data/launch/s05-browser-checks.json

echo "S05 verification passed: real 2026 static export launch verification completed with data validation, reviewed coverage, tests, typecheck, build, export link/leakage assertions, local static smoke, and desktop/mobile browser launch gate evidence."
