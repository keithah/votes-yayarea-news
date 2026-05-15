#!/usr/bin/env bash
set -euo pipefail

pnpm validate-data
node --import tsx --test tests/data/m002-s01-ballot-universe.test.ts

if rg -n "Sample Candidate A|Sample Candidate B|sampleFixture|sample-2026|sample-voter-guide|race-mayor" data/public; then
  echo "Legacy sample fixture content leaked into data/public" >&2
  exit 1
fi
