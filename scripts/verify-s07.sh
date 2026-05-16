#!/usr/bin/env bash
set -euo pipefail

export GITHUB_PAGES="${GITHUB_PAGES:-true}"
export NEXT_PUBLIC_SITE_ORIGIN="${NEXT_PUBLIC_SITE_ORIGIN:-https://votes.yayarea.news}"

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
run_phase "deterministic source acquisition refresh" pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested
run_phase "ingestion validation" pnpm validate-ingestion
run_phase "source coverage refresh" pnpm report:source-coverage
run_phase "deterministic position extraction refresh" pnpm extract:positions -- --provider fixture --model fixture-v1 --manifest data/ingestion/manifest.json --out-dir data/extracted
run_phase "extraction validation" pnpm validate-extraction -- --manifest data/ingestion/manifest.json --draft data/extracted/drafts/latest.json --validation-path data/extracted/validation/latest.json
run_phase "reviewed public-position coverage refresh" pnpm review:coverage
run_phase "source-race coverage refresh" pnpm report:source-race-coverage
run_phase "focused S07 launch tests" node --import tsx --test tests/data/s07-*.test.ts
run_phase "all data tests" pnpm test:data
run_phase "typecheck" pnpm typecheck
run_phase "GitHub Pages static export build" pnpm build
run_phase "remove local-only routes from Pages artifact" rm -rf out/debug out/review
run_phase "create nojekyll marker" touch out/.nojekyll
run_phase "S07 route, link, coverage, and leakage export assertions" node scripts/assert-s07-export.mjs --json-out data/launch/s07-launch-export.json
run_phase "S07 local Pages static HTTP smoke" node scripts/smoke-s07-static-export.mjs --json-out data/launch/s07-static-smoke.json
run_phase "S07 launch evidence and Pages workflow proof" node scripts/record-s07-launch-verification.mjs

echo "S07 verification passed: public data validation, deterministic acquisition/extraction and coverage refreshes, focused S07 tests, all data tests, typecheck, GitHub Pages static export build, local-only route removal, export assertions, static HTTP smoke, and launch evidence recording completed."
