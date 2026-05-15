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
    echo "Missing expected S06 static export output: $path" >&2
    exit 1
  fi
done

node <<'NODE'
const fs = require('node:fs');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const html = fs.readFileSync('out/races/mayor/index.html', 'utf8');
const required = [
  'Source-by-candidate comparison',
  'data-matrix-view="desktop"',
  'data-matrix-view="mobile"',
  'data-matrix-cell-id="cell:src-growsf::ent-sample-candidate-b"',
  'data-position-kind="informational"',
  'data-position-kind="no-public-position"',
  'Recommendation matrix presentation controls',
];

for (const label of required) {
  if (!html.includes(label)) fail(`Expected out/races/mayor/index.html to include ${JSON.stringify(label)}`);
}

const forbidden = [
  'Static candidate-by-source matrix placeholder',
  'before matrix work ships',
  'unfinished matrix',
  'title="Comparison matrix"',
  '.gsd/',
];

for (const label of forbidden) {
  if (html.includes(label)) fail(`Did not expect out/races/mayor/index.html to include ${JSON.stringify(label)}`);
}
NODE

echo "S06 verification passed: public data validation, matrix route tests, typecheck, static export, and mayor matrix HTML assertions."
