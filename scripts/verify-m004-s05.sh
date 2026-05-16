#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

run_phase() {
  local phase="$1"
  shift
  echo "==> M004/S05 phase: ${phase}"
  "$@" || {
    local exit_code=$?
    echo "M004/S05 verification failed during phase: ${phase}" >&2
    exit "${exit_code}"
  }
}

run_phase "S04 local static-export regression proof" pnpm verify:m004:s04

: "${GITHUB_PAGES:=true}"
: "${GITHUB_REPOSITORY:=keithah/votes-yayarea-news}"
: "${NEXT_PUBLIC_SITE_ORIGIN:=https://keithah.github.io/votes-yayarea-news}"
: "${M004_S05_LIVE_ORIGIN:=https://keithah.github.io/votes-yayarea-news}"
export GITHUB_PAGES GITHUB_REPOSITORY NEXT_PUBLIC_SITE_ORIGIN

run_phase "GitHub Pages-mode static build" pnpm build
run_phase "S04 local static route assertions against Pages-mode out/" node scripts/assert-m004-s04-public-routes.mjs
run_phase "live GitHub Pages route assertions" node scripts/assert-m004-s05-live-pages.mjs --origin "${M004_S05_LIVE_ORIGIN}" --json-out data/launch/m004-s05-live-pages.json
run_phase "validated M004/S05 launch summary" node scripts/record-m004-s05-launch-verification.mjs --live-report data/launch/m004-s05-live-pages.json --json-out data/launch/m004-s05-launch-verification.json --latest-out data/launch/latest.json

echo "M004/S05 verification passed: S04 regression proof, Pages-mode build, local route assertions, live route assertions, and durable launch summary validation completed."
