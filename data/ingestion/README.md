# Source ingestion fixtures

`data/ingestion/` contains deterministic inputs for the source-ingestion pipeline. These files are committed so tests and future ingestion commands can run without network access.

## Important sample-data rule

The HTML fixtures in this directory are **representative samples only**. They are not official 2026 election claims, endorsements, recommendations, or voter-guide content. They exist to exercise ingestion behavior against the public source IDs currently defined in `data/public/sources.json`.

## Layout

Committed inputs:

- `manifest.json` — maps public `sourceId` values to fixture files, canonical URLs, and stable artifact IDs.
- `fixtures/*.html` — representative source-guide HTML with boilerplate, scripts/styles, headings, and body text for cleaner/chunker tests.

Generated outputs:

- `data/ingested/raw/<source-stem>.html` — raw fixture or fetched body preserved for audit.
- `data/ingested/artifacts/<source-stem>.json` — normalized clean text plus source, artifact, raw, and chunk references.
- `data/ingested/chunks/<source-stem>.json` — ordered chunks for downstream extraction.
- `data/ingested/runs/latest.json` — durable run summary with phase, target, artifact, count, and issue diagnostics.
- `data/ingested/validation/latest.json` — validation report with checked files, deterministic counts, and path-qualified issue codes.

## Commands

```bash
pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested
pnpm validate-ingestion
```

`pnpm validate-ingestion` defaults to `data/ingestion/manifest.json`, `data/public/sources.json`, and `data/ingested`. It exits non-zero when generated outputs are incomplete, malformed, source-orphaned, failed, or unsafe for S04 consumption.

## Failure modes and diagnostics

Validation reports every issue with a stable `code`, `severity`, `path`, and optional `sourceId` / `artifactId`. Common failure modes:

- `missing_generated_file` / `missing_raw_capture` — a manifest target lacks a raw capture, clean artifact, chunk file, or run-referenced file.
- `artifact_json_malformed`, `chunk_json_malformed`, `run_summary_json_malformed` — generated JSON cannot be parsed.
- `unknown_source_id` — a manifest or artifact references a `sourceId` not present in `data/public/sources.json`.
- `artifact_id_mismatch`, `artifact_source_mismatch`, `chunk_artifact_mismatch`, `chunk_source_mismatch` — generated files do not match the manifest target identity.
- `empty_clean_text`, `low_clean_text`, `empty_chunk_text` — normalized text is missing or too short to support extraction.
- `duplicate_chunk_id`, `duplicate_chunk_order`, `chunk_order_gap` — chunk IDs or order values are not deterministic and contiguous.
- `run_summary_failed`, `run_phase_failed`, `run_target_failed`, `run_issue_error`, `run_errors_recorded` — the latest ingestion run recorded a failed status, phase, target, or error diagnostic.

When validation fails, inspect `data/ingested/validation/latest.json` first, then `data/ingested/runs/latest.json`. Both files are designed for future agents to debug without reading GSD planning artifacts.

## Manual fallback workflow

If a source cannot be fetched or cleaned automatically:

1. Preserve the original body under `data/ingested/raw/` with the same source stem the manifest would generate.
2. Create or repair the clean artifact in `data/ingested/artifacts/` using the manifest `sourceId`, `targetId`, `artifactId`, `canonicalUrl`, `rawPath`, and `chunkPath`.
3. Create `data/ingested/chunks/` entries with IDs formatted as `<artifactId>-chunk-001`, `<artifactId>-chunk-002`, and contiguous `order` values starting at `1`.
4. Rerun `pnpm validate-ingestion` and fix every path-qualified error before S04 extraction begins.

Manual edits should preserve the raw capture and should not invent source IDs outside `data/public/sources.json`.

## Network-fetch caveats

Fixture ingestion is the default deterministic mode. URL-mode targets require `--allow-network` on `pnpm ingest:sources`; otherwise they fail closed and record diagnostics. Network fetches are intentionally bounded by timeout, content type, and maximum input size. Treat fetched output as volatile: rerun validation after every fetch and compare `data/ingested/runs/latest.json` before using new artifacts.

## S04 consumption contract

S04 extraction should consume `data/ingested/artifacts/*.json` and `data/ingested/chunks/*.json`, not scrape raw HTML directly. Raw captures exist for audit and fallback only. A valid artifact provides the source linkage and full normalized text; chunk files provide deterministic extraction units with stable IDs and source/artifact references.

Before extraction, run:

```bash
pnpm validate-ingestion
```

Proceed only when `data/ingested/validation/latest.json` has `ok: true` and `counts.errors: 0`.
