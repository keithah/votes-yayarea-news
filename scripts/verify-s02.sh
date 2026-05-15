#!/usr/bin/env bash
set -euo pipefail

html_path="out/debug/races/california-governor/__next._full.txt"

pnpm validate-data
pnpm test:data
node --import tsx --test tests/ingestion/m002-s02-source-coverage.test.ts
pnpm report:source-coverage
pnpm typecheck
pnpm build

if [[ ! -f "$html_path" ]]; then
  echo "Missing exported debug route: $html_path" >&2
  exit 1
fi

assert_contains() {
  local marker="$1"
  if ! grep -Fq "$marker" "$html_path"; then
    echo "Missing expected marker in $html_path: $marker" >&2
    exit 1
  fi
}

assert_contains "Data debug"
assert_contains "California Governor"
assert_contains "california-governor"
assert_contains '"children":"Sources"'
assert_contains '"children":1'
assert_contains '"children":"Evidence"'
assert_contains '"children":61'
assert_contains "Manual override"
assert_contains "absent"
assert_contains "data/public/races/california-governor.json"
assert_contains "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf"

echo "S02 verification passed: data validation, loader tests, source coverage diagnostics, typecheck, static export, and California Governor debug route markers."
