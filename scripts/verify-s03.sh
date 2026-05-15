#!/usr/bin/env bash
set -euo pipefail

manifest_path="data/ingestion/manifest.json"
ingested_dir="data/ingested"
run_path="$ingested_dir/runs/latest.json"
validation_path="$ingested_dir/validation/latest.json"

pnpm test:ingestion
pnpm ingest:sources -- --manifest "$manifest_path" --out "$ingested_dir"
pnpm validate-ingestion
pnpm validate-data
pnpm typecheck
pnpm build

required_paths=(
  "$manifest_path"
  "$run_path"
  "$validation_path"
  "$ingested_dir/raw/src-sf-chronicle-mayor-sample.html"
  "$ingested_dir/raw/src-growsf-mayor-sample.html"
  "$ingested_dir/artifacts/src-sf-chronicle-mayor-sample.json"
  "$ingested_dir/artifacts/src-growsf-mayor-sample.json"
  "$ingested_dir/chunks/src-sf-chronicle-mayor-sample.json"
  "$ingested_dir/chunks/src-growsf-mayor-sample.json"
)

for path in "${required_paths[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected S03 ingestion output: $path" >&2
    exit 1
  fi
done

node <<'NODE'
const fs = require('node:fs');

const runPath = 'data/ingested/runs/latest.json';
const validationPath = 'data/ingested/validation/latest.json';
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));

if (run.status !== 'complete') {
  console.error(`Expected ${runPath} status=complete, got ${run.status}`);
  process.exit(1);
}

if (!validation.ok || validation.counts?.errors !== 0) {
  console.error(`Expected ${validationPath} ok=true and counts.errors=0`);
  process.exit(1);
}

const expectedArtifacts = new Set([
  'art-sf-chronicle-mayor-sample',
  'art-growsf-mayor-sample',
]);
for (const target of run.targets ?? []) {
  expectedArtifacts.delete(target.artifactId);
}
if (expectedArtifacts.size > 0) {
  console.error(`Missing run targets for artifacts: ${Array.from(expectedArtifacts).join(', ')}`);
  process.exit(1);
}
NODE

echo "S03 verification passed: ingestion tests, deterministic fixture ingestion, ingestion validation, public data validation, typecheck, static build, and generated diagnostics."
