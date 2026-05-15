#!/usr/bin/env bash
set -euo pipefail

run_phase() {
  local phase="$1"
  shift
  echo "==> S09 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "S09 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  }
}

run_phase_capture() {
  local phase="$1"
  shift
  echo "==> S09 phase: ${phase}"
  local output
  if ! output=$("$@"); then
    local exit_code=$?
    printf '%s\n' "$output" >&2
    echo "S09 verification failed during phase: ${phase}" >&2
    exit "$exit_code"
  fi
  printf '%s\n' "$output"
  S09_CAPTURED_OUTPUT="$output"
}

run_phase "public data validation" pnpm validate-data
run_phase "data, route, share metadata, analytics, and launch-gate tests" pnpm test:data
run_phase "share metadata tests" node --import tsx --test tests/data/share-metadata.test.ts
run_phase "analytics event tests" node --import tsx --test tests/data/analytics-events.test.ts
run_phase "typecheck" pnpm typecheck
run_phase "static export build" pnpm build
run_phase "S09 path-qualified export assertions" node scripts/assert-s09-export.mjs
run_phase_capture "production-like local static export smoke" node scripts/smoke-s09-static-export.mjs
run_phase "launch gate recording and checking" node scripts/record-s09-launch-gates.mjs --smoke-json "$S09_CAPTURED_OUTPUT"

echo "S09 verification passed: data validation, data/share/analytics tests, typecheck, static export build, export assertions, local static smoke, and launch-gate recording/checking."
