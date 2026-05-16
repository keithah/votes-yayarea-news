#!/usr/bin/env bash
set -euo pipefail

readonly FORBIDDEN_PATTERN="Sample Candidate A|Sample Candidate B|sample-2026|sample-voter-guide|race-mayor"
readonly SOURCE_RACE_COVERAGE_REPORT="data/public/source-race-coverage.json"

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

log_step "Run S01 source/race coverage contract tests"
node --import tsx --test tests/data/source-race-coverage.test.ts

log_step "Generate durable source/race coverage artifact"
pnpm report:source-race-coverage

log_step "Assert source/race coverage artifact exists"
assert_file_exists "$SOURCE_RACE_COVERAGE_REPORT" "source/race coverage report"

log_step "Validate public data"
pnpm validate-data

log_step "Typecheck"
pnpm typecheck

log_step "Assert public data has no legacy sample Mayor leakage"
assert_no_forbidden_text "data/public" "public source data"

echo "S01 verification passed: source/race coverage contract tests, durable coverage report generation, data validation, typecheck, and public-data sample-leak assertions."
