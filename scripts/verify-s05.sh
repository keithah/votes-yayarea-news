#!/usr/bin/env bash
set -euo pipefail

pnpm validate-data
node --import tsx --test tests/data/s05-launch-verification.test.ts
pnpm typecheck
pnpm build
node scripts/assert-s05-launch-export.mjs
node scripts/smoke-s05-static-export.mjs --json-out data/launch/s05-static-smoke.json
node scripts/record-s05-launch-verification.mjs

echo "S05 verification passed: data validation, S05 launch tests, typecheck, static build, export assertions, static smoke, and launch artifact validation."
