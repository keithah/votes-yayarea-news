#!/usr/bin/env bash
set -euo pipefail

homepage_path="out/index.html"
race_path="out/races/mayor/index.html"

pnpm validate-data
pnpm test:data
pnpm typecheck
pnpm build

required_static_paths=(
  "$homepage_path"
  "$race_path"
)

for path in "${required_static_paths[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected S05 static export output: $path" >&2
    exit 1
  fi
done

node <<'NODE'
const fs = require('node:fs');

const checks = [
  {
    path: 'out/index.html',
    labels: ['A public trail for local election endorsements.', 'San Francisco Mayor', '/races/mayor/'],
  },
  {
    path: 'out/races/mayor/index.html',
    labels: ['Public race shell', 'Consensus snapshot', 'Comparison matrix', 'Receipts drawer'],
  },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (const check of checks) {
  const html = fs.readFileSync(check.path, 'utf8');
  for (const label of check.labels) {
    if (!html.includes(label)) {
      fail(`Expected ${check.path} to include ${JSON.stringify(label)}`);
    }
  }
}
NODE

echo "S05 verification passed: public data validation, data/UI route tests, typecheck, static build, and homepage-to-mayor static export smoke checks."
