# S03 ingested artifacts and S04 extraction handoff

`data/ingested/` is the local, deterministic boundary between source collection and LLM-compatible extraction. S04 extraction reads this directory; it must not scrape public websites or raw external pages at extraction time.

## Regenerate, validate, and report coverage

```bash
pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested
pnpm validate-ingestion
pnpm report:source-coverage
pnpm verify:s03
```

`pnpm verify:s04` also checks that required artifact/chunk files exist before extraction. If a path is missing, rerun ingestion with the command above and inspect validation/coverage diagnostics before extracting positions.

## Layout

- `raw/*.txt|html` — original deterministic fixture or fetched source body for audit and manual fallback.
- `artifacts/*.json` — normalized clean text with source, artifact, raw, and chunk references.
- `chunks/*.json` — bounded extraction units with stable chunk IDs used by evidence records.
- `runs/latest.json` — latest ingestion run status, target IDs, counts, timestamps, checked paths, and sanitized issues.
- `validation/latest.json` — ingestion validation status, deterministic counts, checked paths, and path-qualified issues.
- `coverage/latest.json` — source availability status for every `data/public/sources.json` source, including captured, pending, manual-only, excluded, unavailable, and latest runtime capture status.

## Current M002/S02 launch capture

The default manifest currently captures the California Secretary of State certified candidate list as a deterministic text fixture:

- source: `src-ca-secretary-of-state`
- target: `fixture-ca-secretary-of-state-2026-primary-certified-candidates`
- artifact: `art-ca-secretary-of-state-2026-primary-certified-candidates`
- canonical URL: `https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf`

This artifact is official candidate-list evidence only. It is not an endorsement or recommendation source. San Francisco local contests/measures and public guide/endorsement sources remain visible through `coverage/latest.json` as `manual-only`, `pending`, or `unavailable` until real public artifacts are available.

## S04 extraction contract

S04 commands consume `artifacts/*.json` and `chunks/*.json` through `data/ingestion/manifest.json`. Use a public race slug that has ingested source evidence:

```bash
pnpm extract:positions -- --provider fixture --race-slug california-governor
pnpm validate-extraction -- --race-slug california-governor
```

Optional live extraction is explicit:

```bash
pnpm extract:positions -- --provider openai --model gpt-4o-mini --race-slug california-governor
```

Live extraction requires `OPENAI_API_KEY` in the environment. Missing credentials, malformed provider JSON, missing artifact/chunk files, source/entity/race mismatches, oversized chunks, and evidence quotes that do not appear in the referenced chunk are reported as sanitized issues in `data/extracted/runs/latest.json` and `data/extracted/validation/latest.json`.

## Redaction and publication policy

Never persist or print API keys, authorization headers, cookies, paywalled full text, private source material, or raw provider responses that may contain secrets. Hidden generated drafts in `data/extracted/` and editable review files in `manual/reviews/` are not public data. They become public only when `pnpm review:positions publish --race-slug california-governor` copies verified/public review records into `manual/overrides/races/` and public validation passes.

## Handoff to S05

S05 should use public loaders over `data/public/` plus `manual/overrides/`. Treat `data/ingested/`, `data/extracted/`, and `manual/reviews/` as operational evidence and review surfaces, not as public rendering inputs.
