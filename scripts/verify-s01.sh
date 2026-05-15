#!/usr/bin/env bash
set -euo pipefail

readonly GOVERNOR_EXPORT="out/races/california-governor/index.html"
readonly MAYOR_EXPORT="out/races/mayor/index.html"
readonly FORBIDDEN_PATTERN="Sample Candidate A|Sample Candidate B|sample-2026|sample-voter-guide|race-mayor"

log_step() {
  printf '\n==> %s\n' "$1"
}

assert_no_forbidden_text() {
  local target="$1"
  local label="$2"

  if [[ ! -e "$target" ]]; then
    echo "Missing path for sample-leak assertion ($label): $target" >&2
    exit 1
  fi

  if rg -n --hidden --glob '!**/.DS_Store' "$FORBIDDEN_PATTERN" "$target"; then
    echo "Legacy sample Mayor fixture content leaked into $label: $target" >&2
    echo "Forbidden pattern: $FORBIDDEN_PATTERN" >&2
    exit 1
  fi
}

assert_file_exists() {
  local path="$1"
  local description="$2"

  if [[ ! -f "$path" ]]; then
    echo "Missing $description: $path" >&2
    exit 1
  fi
}

assert_file_absent() {
  local path="$1"
  local description="$2"

  if [[ -e "$path" ]]; then
    echo "Unexpected $description: $path" >&2
    exit 1
  fi
}

log_step "Run S01 ballot-universe test"
node --import tsx --test tests/data/m002-s01-ballot-universe.test.ts

log_step "Run full data test suite"
pnpm test:data

log_step "Validate public data"
pnpm validate-data

log_step "Typecheck"
pnpm typecheck

log_step "Build static export"
pnpm build

log_step "Assert public data has no legacy sample Mayor leakage"
assert_no_forbidden_text "data/public" "public source data"

log_step "Assert generated static export has expected S01 routes"
assert_file_exists "$GOVERNOR_EXPORT" "California Governor static race export"
assert_file_absent "$MAYOR_EXPORT" "legacy Mayor static race export"

log_step "Assert generated static export has no legacy sample Mayor leakage"
assert_no_forbidden_text "out" "generated static export"

echo "S01 verification passed: data tests, validation, typecheck, static export, Governor route, and sample-leak assertions."
