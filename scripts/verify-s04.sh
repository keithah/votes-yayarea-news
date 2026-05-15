#!/usr/bin/env bash
set -euo pipefail

manifest_path="data/ingestion/manifest.json"
ingested_run_path="data/ingested/runs/latest.json"
extracted_dir="data/extracted"
extracted_draft_path="$extracted_dir/drafts/latest.json"
extracted_run_path="$extracted_dir/runs/latest.json"
extracted_validation_path="$extracted_dir/validation/latest.json"
review_path="manual/reviews/races/mayor.json"
override_path="manual/overrides/races/mayor.json"

required_s03_paths=(
  "$manifest_path"
  "$ingested_run_path"
  "data/ingested/artifacts/src-sf-chronicle-mayor-sample.json"
  "data/ingested/chunks/src-sf-chronicle-mayor-sample.json"
  "data/ingested/artifacts/src-growsf-mayor-sample.json"
  "data/ingested/chunks/src-growsf-mayor-sample.json"
)

for path in "${required_s03_paths[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected S03 ingestion output: $path" >&2
    echo "Rerun: pnpm ingest:sources -- --manifest $manifest_path --out data/ingested" >&2
    exit 1
  fi
done

pnpm extract:positions -- --provider fixture --model fixture-v1 --race-slug mayor --manifest "$manifest_path" --out-dir "$extracted_dir"
pnpm validate-extraction -- --race-slug mayor --manifest "$manifest_path" --draft "$extracted_draft_path" --validation-path "$extracted_validation_path"
pnpm review:positions prepare --race-slug mayor --draft "$extracted_draft_path"

node <<'NODE'
const fs = require('node:fs');
const reviewPath = 'manual/reviews/races/mayor.json';
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
if (!Array.isArray(review.positions) || review.positions.length === 0) {
  console.error(`Expected ${reviewPath} to contain sample positions before publication.`);
  process.exit(1);
}
for (const position of review.positions) {
  position.status = 'verified';
  position.publicationStatus = 'public';
  position.reviewerNotes = 'Verified by deterministic S04 verifier fixture; not a real 2026 election claim.';
}
review.status = 'ready';
review.updatedAt = new Date().toISOString();
fs.writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
NODE

pnpm review:positions status --race-slug mayor
pnpm review:positions publish --race-slug mayor
pnpm validate-data
pnpm test:extraction
pnpm typecheck
pnpm build

required_s04_paths=(
  "$extracted_draft_path"
  "$extracted_run_path"
  "$extracted_validation_path"
  "$review_path"
  "$override_path"
)

for path in "${required_s04_paths[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected S04 output: $path" >&2
    exit 1
  fi
done

node <<'NODE'
const fs = require('node:fs');

const runPath = 'data/extracted/runs/latest.json';
const validationPath = 'data/extracted/validation/latest.json';
const draftPath = 'data/extracted/drafts/latest.json';
const reviewPath = 'manual/reviews/races/mayor.json';
const overridePath = 'manual/overrides/races/mayor.json';
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (run.status !== 'complete') fail(`Expected ${runPath} status=complete, got ${run.status}`);
if (run.provider?.provider !== 'fixture') fail(`Expected ${runPath} provider=fixture, got ${run.provider?.provider}`);
if (run.outputPath !== draftPath) fail(`Expected ${runPath} outputPath=${draftPath}, got ${run.outputPath}`);
if (!validation.ok || validation.counts?.errors !== 0) fail(`Expected ${validationPath} ok=true and counts.errors=0`);
if ((draft.positions?.length ?? 0) < 1 || (draft.evidence?.length ?? 0) < 1) fail(`Expected ${draftPath} to contain positions and evidence`);
if (review.status !== 'published') fail(`Expected ${reviewPath} status=published, got ${review.status}`);
if (!review.positions?.every((position) => position.status === 'verified' && position.publicationStatus === 'public')) fail(`Expected all ${reviewPath} positions to be verified/public`);
const overridePositions = override.race?.positions ?? [];
for (const position of review.positions) {
  if (!overridePositions.some((candidate) => candidate.id === position.id)) fail(`Expected ${overridePath} to include published position ${position.id}`);
}
NODE

echo "S04 verification passed: deterministic extraction, validation, review publication, public data validation, extraction/loader tests, typecheck, static build, and artifact coherence checks."
