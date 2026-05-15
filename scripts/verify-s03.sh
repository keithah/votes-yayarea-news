#!/usr/bin/env bash
set -euo pipefail

manifest_path="data/ingestion/manifest.json"
ingested_dir="data/ingested"
ingested_run_path="$ingested_dir/runs/latest.json"
ingested_validation_path="$ingested_dir/validation/latest.json"
ingested_coverage_path="$ingested_dir/coverage/latest.json"
source_coverage_path="data/ingestion/source-coverage.json"
extracted_dir="data/extracted"
extracted_draft_path="$extracted_dir/drafts/latest.json"
extracted_run_path="$extracted_dir/runs/latest.json"
extracted_validation_path="$extracted_dir/validation/latest.json"
reviewed_coverage_path="data/reviewed/position-coverage.json"

pnpm test:ingestion
pnpm test:extraction
pnpm test:data

pnpm ingest:sources -- --manifest "$manifest_path" --out "$ingested_dir"
pnpm validate-ingestion
pnpm report:source-coverage

pnpm extract:positions -- --provider fixture --model fixture-v1 --manifest "$manifest_path" --out-dir "$extracted_dir"
pnpm validate-extraction -- --manifest "$manifest_path" --draft "$extracted_draft_path" --validation-path "$extracted_validation_path"
pnpm review:coverage -- --source-coverage "$source_coverage_path" --ingested-coverage "$ingested_coverage_path" --ingested-validation "$ingested_validation_path" --report "$reviewed_coverage_path"

pnpm validate-data
pnpm typecheck
pnpm build

required_paths=(
  "$manifest_path"
  "$source_coverage_path"
  "$ingested_run_path"
  "$ingested_validation_path"
  "$ingested_coverage_path"
  "$ingested_dir/raw/src-ca-secretary-of-state-2026-primary-certified-candidates.txt"
  "$ingested_dir/artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json"
  "$ingested_dir/chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json"
  "$extracted_draft_path"
  "$extracted_run_path"
  "$extracted_validation_path"
  "$reviewed_coverage_path"
)

for path in "${required_paths[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing expected S03 verification output: $path" >&2
    exit 1
  fi
done

node <<'NODE'
const fs = require('node:fs');

const expectedRealArtifact = 'art-ca-secretary-of-state-2026-primary-certified-candidates';
const expectedRealRaces = new Set([
  'race-california-governor',
  'race-california-lieutenant-governor',
  'race-california-secretary-of-state',
  'race-california-controller',
  'race-california-treasurer',
  'race-california-attorney-general',
  'race-california-insurance-commissioner',
  'race-california-superintendent-public-instruction',
  'race-board-of-equalization-district-2',
  'race-us-house-district-11',
  'race-us-house-district-15',
  'race-state-assembly-district-17',
  'race-state-assembly-district-19',
]);

const paths = {
  ingestedRun: 'data/ingested/runs/latest.json',
  ingestedValidation: 'data/ingested/validation/latest.json',
  ingestedCoverage: 'data/ingested/coverage/latest.json',
  extractedRun: 'data/extracted/runs/latest.json',
  extractedDraft: 'data/extracted/drafts/latest.json',
  extractedValidation: 'data/extracted/validation/latest.json',
  reviewedCoverage: 'data/reviewed/position-coverage.json',
};

const read = (name) => JSON.parse(fs.readFileSync(paths[name], 'utf8'));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const ingestedRun = read('ingestedRun');
const ingestedValidation = read('ingestedValidation');
const ingestedCoverage = read('ingestedCoverage');
const extractedRun = read('extractedRun');
const extractedDraft = read('extractedDraft');
const extractedValidation = read('extractedValidation');
const reviewedCoverage = read('reviewedCoverage');

if (ingestedRun.status !== 'complete') fail(`Expected ${paths.ingestedRun} status=complete, got ${ingestedRun.status}`);
if (!ingestedValidation.ok || ingestedValidation.counts?.errors !== 0) fail(`Expected ${paths.ingestedValidation} ok=true and counts.errors=0`);
if (!ingestedCoverage.ok || ingestedCoverage.counts?.errors !== 0) fail(`Expected ${paths.ingestedCoverage} ok=true and counts.errors=0`);

const ingestedArtifacts = new Set((ingestedRun.targets ?? []).map((target) => target.artifactId));
if (!ingestedArtifacts.has(expectedRealArtifact)) fail(`Expected ${paths.ingestedRun} to include ${expectedRealArtifact}`);
if ([...ingestedArtifacts].some((artifactId) => /sample/i.test(artifactId))) fail(`Expected ${paths.ingestedRun} to exclude sample artifacts; got ${[...ingestedArtifacts].join(', ')}`);

if (extractedRun.status !== 'complete') fail(`Expected ${paths.extractedRun} status=complete, got ${extractedRun.status}`);
if (extractedRun.provider?.provider !== 'fixture') fail(`Expected ${paths.extractedRun} provider=fixture, got ${extractedRun.provider?.provider}`);
if (extractedRun.outputPath !== paths.extractedDraft) fail(`Expected ${paths.extractedRun} outputPath=${paths.extractedDraft}, got ${extractedRun.outputPath}`);
if (extractedRun.validationPath !== paths.extractedValidation) fail(`Expected ${paths.extractedRun} validationPath=${paths.extractedValidation}, got ${extractedRun.validationPath}`);
if (!extractedValidation.ok || extractedValidation.counts?.errors !== 0) fail(`Expected ${paths.extractedValidation} ok=true and counts.errors=0`);

const extractedInputRaces = new Set((extractedRun.inputs ?? []).map((input) => input.raceId));
for (const raceId of expectedRealRaces) {
  if (!extractedInputRaces.has(raceId)) fail(`Expected ${paths.extractedRun} to include extraction input for ${raceId}`);
}
if (extractedInputRaces.size !== expectedRealRaces.size) fail(`Expected ${paths.extractedRun} to include exactly ${expectedRealRaces.size} real race inputs, got ${extractedInputRaces.size}`);
if ((extractedRun.inputs ?? []).some((input) => /sample/i.test(`${input.id} ${input.artifactId}`))) fail(`Expected ${paths.extractedRun} to exclude sample extraction inputs`);

if ((extractedDraft.positions?.length ?? 0) < expectedRealRaces.size) fail(`Expected ${paths.extractedDraft} to contain at least one fixture draft per real race`);
if ((extractedDraft.evidence?.length ?? 0) < expectedRealRaces.size) fail(`Expected ${paths.extractedDraft} to contain evidence for fixture drafts`);
if (!extractedDraft.positions?.every((position) => position.publicationStatus === 'hidden')) fail(`Expected generated drafts in ${paths.extractedDraft} to remain hidden`);

if (!reviewedCoverage.ok || reviewedCoverage.counts?.errors !== 0) fail(`Expected ${paths.reviewedCoverage} ok=true and counts.errors=0`);
if ((reviewedCoverage.counts?.publicPositions ?? 0) <= 0) fail(`Expected ${paths.reviewedCoverage} to count public positions`);
if ((reviewedCoverage.counts?.reviewedPublicPositions ?? 0) !== reviewedCoverage.counts?.publicPositions) fail(`Expected every public position in ${paths.reviewedCoverage} to be reviewed`);
if ((reviewedCoverage.counts?.evidenceBackedPublicPositions ?? 0) !== reviewedCoverage.counts?.publicPositions) fail(`Expected every public position in ${paths.reviewedCoverage} to have evidence`);
if ((reviewedCoverage.counts?.informational ?? 0) <= 0) fail(`Expected ${paths.reviewedCoverage} to count informational records from the captured source`);

const caSource = reviewedCoverage.bySource?.find((source) => source.sourceId === 'src-ca-secretary-of-state');
if (!caSource || caSource.coverageStatus !== 'captured') fail(`Expected ${paths.reviewedCoverage} to mark src-ca-secretary-of-state captured`);
NODE

echo "S03 verification passed: ingestion, extraction, data tests, deterministic real-source ingestion refresh, source coverage, fixture extraction across real M002 races, extraction validation, reviewed-position coverage, public data validation, typecheck, static build, and diagnostic coherence checks."
