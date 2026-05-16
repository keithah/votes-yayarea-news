#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ACQUISITION_DIR="data/acquisition"
MANIFEST="data/ingestion/m004-live-manifest.json"
INGESTED_DIR="data/ingested"

echo "[m004:s01] acquire source diagnostics"
pnpm acquire:sources -- --sources data/public/sources.json --candidates data/acquisition/source-candidates.json --out "$ACQUISITION_DIR" --manifest "$MANIFEST" --fetch-timeout-ms 10000 --max-candidate-bytes 1000000

echo "[m004:s01] validate acquisition report"
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const report = JSON.parse(await readFile('data/acquisition/latest.json', 'utf8'));
if (report.version !== 1 || !Array.isArray(report.diagnostics)) throw new Error('Invalid acquisition latest.json shape.');
if (report.diagnostics.length !== report.counts.sources) throw new Error(`Expected one diagnostic per source; got ${report.diagnostics.length} for ${report.counts.sources}.`);
for (const diagnostic of report.diagnostics) {
  for (const field of ['sourceId', 'phase', 'status', 'timestamp']) {
    if (!diagnostic[field]) throw new Error(`Diagnostic missing ${field}: ${JSON.stringify(diagnostic)}`);
  }
  if (diagnostic.status === 'captured') {
    if (!diagnostic.capturedArtifactPath || diagnostic.manifestIncluded !== true) throw new Error(`Captured diagnostic lacks artifact/manifest signal: ${JSON.stringify(diagnostic)}`);
  }
}
NODE

echo "[m004:s01] run acquisition contract tests"
node --import tsx --test tests/acquisition/acquire-sources.test.ts

echo "[m004:s01] ingest captured manifest when targets exist"
TARGET_COUNT=$(node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('data/ingestion/m004-live-manifest.json', 'utf8'));
console.log(Array.isArray(manifest.targets) ? manifest.targets.length : -1);
NODE
)
if [[ "$TARGET_COUNT" -gt 0 ]]; then
  pnpm ingest:sources -- --manifest "$MANIFEST" --out "$INGESTED_DIR" --fixture-root .
  pnpm validate-ingestion -- --manifest "$MANIFEST" --out "$INGESTED_DIR" --public-sources data/public/sources.json --report data/ingested/validation/m004-s01-latest.json
else
  echo "[m004:s01] no captured targets in current candidate ledger; ingestion validation skipped after acquisition diagnostics validation"
fi

echo "[m004:s01] typecheck"
pnpm typecheck
