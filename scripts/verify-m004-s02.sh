#!/usr/bin/env bash
set -euo pipefail

node --import tsx --test tests/extraction/bulk-review.test.ts
node --import tsx --test tests/extraction/m004-bulk-publish.test.ts
pnpm review:coverage -- --bulk-diagnostics data/reviewed/m004-s02-bulk-latest.json
pnpm validate-data
pnpm test:extraction
pnpm typecheck
