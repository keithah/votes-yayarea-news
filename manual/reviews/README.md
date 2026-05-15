# Local position review workflow

LLM extraction drafts are never public by themselves. The local review loop copies draft positions into editable JSON under `manual/reviews/races/`, then publishes only records that a reviewer explicitly marks ready.

## Commands

Deterministic local flow:

```bash
pnpm extract:positions -- --provider fixture --race-slug california-governor
pnpm validate-extraction -- --race-slug california-governor
pnpm review:positions prepare --race-slug california-governor
pnpm review:positions status --race-slug california-governor
pnpm review:positions publish --race-slug california-governor
```

Authoritative S04 closeout:

```bash
pnpm verify:s04
```

`pnpm verify:s04` reruns fixture extraction, validates it, prepares review state, marks the representative sample positions verified/public, publishes them into manual overrides, validates public data, runs extraction/loader tests, typechecks, builds, and asserts diagnostic artifact coherence.

Optional live extraction is explicit and credential-gated:

```bash
pnpm extract:positions -- --provider openai --model gpt-4o-mini --race-slug california-governor
```

Live extraction requires `OPENAI_API_KEY`. Missing credentials or provider failures should fail closed with sanitized diagnostics; the deterministic fixture path remains the default verifier and does not require network access.

- `prepare` reads `data/extracted/drafts/latest.json` and creates or updates `manual/reviews/races/{slug}.json`. New records start as `status: "draft"` and `publicationStatus: "hidden"`.
- `status` validates the review JSON and reports path-qualified readiness issues.
- `publish` merges only verified/published public review records into `manual/overrides/races/{slug}.json`, then runs the race loaders so invalid overrides fail before completion.

## Editing review JSON

For each position, inspect the label, rationale, evidence quotes, source IDs, artifact IDs, and chunk IDs. Then choose one of these outcomes:

- Keep private: leave `publicationStatus` as `hidden`.
- Reject: set `status` to `rejected` and keep `publicationStatus` as `hidden`.
- Publish: set `status` to `verified` (or `published`) and `publicationStatus` to `public`.

Published positions must keep at least one evidence record with a non-empty quote plus source, artifact, and chunk provenance. Duplicate review IDs, malformed JSON, rejected public records, evidence-less public records, missing provenance, and public records that are not verified/published are rejected by `status`/`publish` diagnostics. If publication creates invalid public data, `publish` fails while exercising the same race loaders used by the static app.

## Output and redaction policy

- `data/extracted/drafts/latest.json` contains generated hidden draft positions and evidence.
- `data/extracted/runs/latest.json` records provider, model, prompt version, status, source/artifact inputs, counts, issue codes, timestamps, and output paths.
- `data/extracted/validation/latest.json` records validation status, checked files, counts, and path-qualified issues.
- `manual/reviews/races/{slug}.json` is the editable local staging file.
- `manual/overrides/races/{slug}.json` is the only file in this workflow that public loaders consume.

Never persist or print API keys, authorization headers, or raw provider responses containing secrets. Generated drafts and review staging files must stay hidden from public loaders; only verified/public records published into manual overrides can appear in the static site.

## Failure modes

- Missing S03 ingestion outputs: rerun `pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested`, then `pnpm validate-ingestion`.
- Missing live provider credentials: deterministic fixture verification still passes; explicit `--provider openai` runs fail with sanitized missing-credential diagnostics.
- Malformed provider JSON, unknown source/entity/race IDs, or evidence quote mismatches: inspect `data/extracted/runs/latest.json` and `data/extracted/validation/latest.json`.
- Missing review or override files: rerun `prepare` and inspect path-qualified CLI output.
- Public loader returns no records after publish: confirm at least one reviewed position is `status: "verified"` or `"published"` and `publicationStatus: "public"`.

## Handoff to S05

S05 should render and test only through public loaders over `data/public/` plus `manual/overrides/`. It should not read `data/extracted/` drafts or `manual/reviews/` staging files directly.

## Static inspection page

Run the Next app or static build and open `/review/races/{slug}`. The page summarizes the latest extraction run, review status, draft positions, evidence quotes, source/artifact/chunk IDs, and the CLI commands needed to publish. It is intentionally read-only because static export cannot write local files.
