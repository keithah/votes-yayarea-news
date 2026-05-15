#!/usr/bin/env bash
set -euo pipefail

log_step() {
  printf '\n[S02] %s\n' "$1"
}

log_step "Run dedicated source coverage and sample-leak tests"
node --import tsx --test tests/ingestion/m002-s02-source-coverage.test.ts

log_step "Run full ingestion test suite"
pnpm test:ingestion

log_step "Validate public data and loader compatibility"
pnpm validate-data
pnpm test:data

log_step "Regenerate deterministic real-source ingestion artifacts"
pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested

log_step "Validate generated ingestion diagnostics"
pnpm validate-ingestion

log_step "Regenerate and validate source availability coverage diagnostics"
pnpm report:source-coverage

log_step "Run TypeScript typecheck"
pnpm typecheck

printf '\nS02 verification passed: real source coverage ledger, deterministic ingestion artifacts, ingestion validation, public data compatibility, type safety, and legacy Mayor sample-leak checks.\n'
