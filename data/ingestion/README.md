# Source ingestion fixtures

`data/ingestion/` contains deterministic inputs for the source-ingestion pipeline. These files are committed so tests and future ingestion commands can run without network access.

## Launch-data rule

The default launch manifest is **real-source only**. It must not contain Mayor sample targets, `sampleFixture: true` launch targets, invented guide URLs, private material, API keys, cookies, paywalled full text, or non-public source content.

Representative/sample fixtures may still be used inside isolated tests, but they do not count as M002 launch coverage and must not appear in `data/ingestion/manifest.json` or `data/ingestion/source-coverage.json` as captured launch sources.

## Coverage statuses

`source-coverage.json` is the maintained availability ledger for every source in `data/public/sources.json`:

- `captured` — the source has a public, material guide/official-record URL and a linked non-sample manifest target.
- `manual-only` — the source is real and relevant, but collection currently requires human review or manual capture because no stable machine-ingestable URL is available.
- `pending` — a source is tracked, but a public 2026 guide, endorsement, or official record has not been confirmed yet.
- `excluded` — a source is intentionally out of scope or not materially relevant for the tracked M002 ballot universe.
- `unavailable` — a source remains listed for accountability, but no usable public launch artifact is available.

Captured coverage rows should include `targetId`; non-captured rows should explain the pending/manual/excluded reason without inventing content.

## Layout

Committed inputs:

- `manifest.json` — maps public `sourceId` values to deterministic, non-sample capture files, canonical URLs, and stable artifact IDs.
- `source-coverage.json` — one availability row for every public source, including captured, pending, manual-only, excluded, or unavailable status.
- `fixtures/*.txt` / `fixtures/*.html` — deterministic offline captures for manifest targets. The default launch fixture is the California Secretary of State certified candidate-list text capture.

Generated outputs:

- `data/ingested/raw/<source-stem>.txt|html` — raw fixture or fetched body preserved for audit.
- `data/ingested/artifacts/<source-stem>.json` — normalized clean text plus source, artifact, raw, and chunk references.
- `data/ingested/chunks/<source-stem>.json` — ordered chunks for downstream extraction.
- `data/ingested/runs/latest.json` — durable run summary with phase, target, artifact, count, and issue diagnostics.
- `data/ingested/validation/latest.json` — validation report with checked files, deterministic counts, and path-qualified issue codes.
- `data/ingested/coverage/latest.json` — source availability report joining public sources, manifest targets, coverage rows, and latest ingestion runtime status.

## Commands

```bash
pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested
pnpm validate-ingestion
pnpm report:source-coverage
```

`pnpm ingest:sources` defaults to network-free fixture mode. `pnpm validate-ingestion` defaults to `data/ingestion/manifest.json`, `data/public/sources.json`, and `data/ingested`. `pnpm report:source-coverage` defaults to `data/ingestion/source-coverage.json` and writes `data/ingested/coverage/latest.json`.

## Failure modes and diagnostics

Validation and coverage reports every issue with a stable `code`, `severity`, `path`, and optional `sourceId` / `artifactId`. Common failure modes:

- `missing_generated_file` / `missing_raw_capture` — a manifest target lacks a raw capture, clean artifact, chunk file, or run-referenced file.
- `artifact_json_malformed`, `chunk_json_malformed`, `run_summary_json_malformed` — generated JSON cannot be parsed.
- `unknown_source_id` — a manifest or artifact references a `sourceId` not present in `data/public/sources.json`.
- `artifact_id_mismatch`, `artifact_source_mismatch`, `chunk_artifact_mismatch`, `chunk_source_mismatch` — generated files do not match the manifest target identity.
- `empty_clean_text`, `low_clean_text`, `empty_chunk_text` — normalized text is missing or too short to support extraction.
- `duplicate_chunk_id`, `duplicate_chunk_order`, `chunk_order_gap` — chunk IDs or order values are not deterministic and contiguous.
- `run_summary_failed`, `run_phase_failed`, `run_target_failed`, `run_issue_error`, `run_errors_recorded` — the latest ingestion run recorded a failed status, phase, target, or error diagnostic.
- `missing_source_coverage`, `stale_coverage_target_id`, `sample_fixture_launch_coverage` — the maintained coverage ledger does not account for every public source or attempts to count sample fixture data as launch coverage.

When validation fails, inspect `data/ingested/validation/latest.json` first, then `data/ingested/runs/latest.json`. When availability coverage fails, inspect `data/ingested/coverage/latest.json` and `data/ingestion/source-coverage.json`. These files are designed for future agents to debug without reading GSD planning artifacts.

## Manual fallback workflow

If a source cannot be fetched or cleaned automatically:

1. Keep the source in `data/public/sources.json` and `data/ingestion/source-coverage.json` with `manual-only`, `pending`, `excluded`, or `unavailable` status plus a clear reason.
2. Do not add a manifest target until the source has a stable public URL and a deterministic capture file.
3. Once manually captured, preserve the original body under `data/ingestion/fixtures/` or `data/ingested/raw/` with a stable source stem and no private/paywalled full text.
4. Create or repair the clean artifact using the manifest `sourceId`, `targetId`, `artifactId`, `canonicalUrl`, `rawPath`, and `chunkPath`.
5. Create `data/ingested/chunks/` entries with IDs formatted as `<artifactId>-chunk-001`, `<artifactId>-chunk-002`, and contiguous `order` values starting at `1`.
6. Rerun `pnpm validate-ingestion` and `pnpm report:source-coverage`; fix every path-qualified error before S04 extraction begins.

Manual edits should preserve source provenance and should not invent source IDs outside `data/public/sources.json`.

## Network-fetch caveats

Fixture ingestion is the default deterministic mode. URL-mode targets require `--allow-network` on `pnpm ingest:sources`; otherwise they fail closed and record diagnostics. Network fetches are intentionally bounded by timeout, content type, and maximum input size. Treat fetched output as volatile: rerun validation after every fetch and compare `data/ingested/runs/latest.json` before using new artifacts.

## S04 consumption contract

S04 extraction should consume `data/ingested/artifacts/*.json` and `data/ingested/chunks/*.json`, not scrape raw external pages directly. Raw captures exist for audit and fallback only. A valid artifact provides the source linkage and full normalized text; chunk files provide deterministic extraction units with stable IDs and source/artifact references.

Before extraction, run:

```bash
pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested
pnpm validate-ingestion
pnpm report:source-coverage
```

Proceed only when `data/ingested/validation/latest.json` has `ok: true`, `counts.errors: 0`, and source coverage reports no errors.
