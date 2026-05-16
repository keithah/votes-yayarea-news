#!/usr/bin/env bash
set -euo pipefail

node --import tsx --test tests/extraction/bulk-review.test.ts
node --import tsx --test tests/extraction/m004-bulk-publish.test.ts
pnpm review:coverage
pnpm validate-data
pnpm test:extraction
pnpm typecheck
