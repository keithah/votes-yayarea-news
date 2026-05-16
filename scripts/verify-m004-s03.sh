#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

DIAGNOSTICS_PATH="data/reviewed/m004-s02-bulk-latest.json"

pnpm report:source-race-coverage -- --publication-diagnostics "${DIAGNOSTICS_PATH}"
pnpm review:coverage -- --bulk-diagnostics "${DIAGNOSTICS_PATH}"
node --import tsx --test tests/extraction/m004-coverage-diagnostics.test.ts
node --import tsx --test tests/data/source-race-coverage.test.ts tests/extraction/reviewed-position-coverage.test.ts
pnpm validate-data
pnpm test:extraction
pnpm typecheck
