# Local position review workflow

LLM extraction drafts are never public by themselves. The local review loop copies draft positions into editable JSON under `manual/reviews/races/`, then publishes only records that a reviewer explicitly marks ready and that keep source-backed evidence.

## S03 operator workflow

`pnpm verify:s03` is the deterministic closeout gate for the real M002 source boundary. It runs ingestion, extraction, data tests, refreshes the non-sample Secretary of State ingestion artifacts, rebuilds source-coverage diagnostics, runs fixture extraction across the real M002 races, validates extraction diagnostics, writes reviewed-position coverage, validates public data, typechecks, and builds the static site.

```bash
pnpm verify:s03
```

After a successful run, inspect these public diagnostics when deciding what can be reviewed or published next:

- `data/ingested/runs/latest.json` and `data/ingested/validation/latest.json` — deterministic source ingestion status.
- `data/ingested/coverage/latest.json` and `data/ingestion/source-coverage.json` — which sources are captured, manual-only, unavailable, or pending.
- `data/extracted/runs/latest.json` and `data/extracted/validation/latest.json` — fixture extraction inputs, counts, issue codes, and validation state for the current real source boundary.
- `data/reviewed/position-coverage.json` — public position counts by kind/status plus unsupported-public-position, missing-evidence, provenance, and source-coverage diagnostics.

Do not rely on private planning files to decide publication readiness; the files above are the auditable operator surface.

## Position publication rules

Only reviewed public records may reach `manual/overrides/` and public loaders:

- A visible position must have `publicationStatus: "public"` and `status: "verified"` or `status: "published"`.
- Every visible position must keep at least one evidence record with a non-empty quote or comparable source-backed text.
- Evidence should include source, artifact, and chunk provenance whenever it came from ingested artifacts; coverage diagnostics report gaps so future operators can close them.
- Explicit source-backed “No Endorsement,” “No Recommendation,” or equivalent statements are real positions. Model them as `kind: "no-position"` with evidence and normal review/publication status.
- Empty endorsement matrix cells are not positions. They remain `no-public-position` placeholders in UI/data presentation and must not get position IDs, evidence IDs, receipts, or manual override records.
- Pending, unavailable, or manual-only sources in `data/ingestion/source-coverage.json` must stay pending/unpublished until real public guide artifacts exist and are ingested or documented through the approved manual path.
- Never invent endorsements, opposition, informational notes, or no-position claims to fill matrix gaps.

## Commands for one-race review

Deterministic local flow for a specific race:

```bash
pnpm extract:positions -- --provider fixture --race-slug california-governor
pnpm validate-extraction -- --race-slug california-governor
pnpm review:positions prepare --race-slug california-governor
pnpm review:positions status --race-slug california-governor
pnpm review:positions publish --race-slug california-governor
pnpm review:coverage
pnpm validate-data
```

Optional live extraction is explicit and credential-gated:

```bash
pnpm extract:positions -- --provider openai --model gpt-4o-mini --race-slug california-governor
```

Live extraction requires `OPENAI_API_KEY`. Missing credentials or provider failures should fail closed with sanitized diagnostics; the deterministic fixture path remains the default verifier and does not require network access.

## Review JSON lifecycle

- `prepare` reads `data/extracted/drafts/latest.json` and creates or updates `manual/reviews/races/{slug}.json`. New records start as `status: "draft"` and `publicationStatus: "hidden"`.
- `status` validates the review JSON and reports path-qualified readiness issues.
- `publish` merges only verified/published public review records into `manual/overrides/races/{slug}.json`, then runs the race loaders so invalid overrides fail before completion.

For each position, inspect the label, rationale, evidence quotes, source IDs, artifact IDs, and chunk IDs. Then choose one of these outcomes:

- Keep private: leave `publicationStatus` as `hidden`.
- Reject: set `status` to `rejected` and keep `publicationStatus` as `hidden`.
- Publish: set `status` to `verified` or `published` and `publicationStatus` to `public`.

Published positions must keep evidence and source provenance. Duplicate review IDs, malformed JSON, rejected public records, evidence-less public records, missing provenance, and public records that are not verified/published are rejected by `status`, `publish`, or `review:coverage` diagnostics. If publication creates invalid public data, `publish` fails while exercising the same race loaders used by the static app.

## Output and redaction policy

- `data/extracted/drafts/latest.json` contains generated hidden draft positions and evidence.
- `data/extracted/runs/latest.json` records provider, model, prompt version, status, source/artifact inputs, counts, issue codes, timestamps, and output paths.
- `data/extracted/validation/latest.json` records validation status, checked files, counts, and path-qualified issues.
- `data/reviewed/position-coverage.json` records deterministic reviewed-position coverage diagnostics for public data and overrides.
- `manual/reviews/races/{slug}.json` is the editable local staging file.
- `manual/overrides/races/{slug}.json` is the only file in this workflow that public loaders consume.

Never persist or print API keys, authorization headers, or raw provider responses containing secrets. Generated drafts and review staging files must stay hidden from public loaders; only verified/public records published into manual overrides can appear in the static site.

## Failure modes

- Missing S03 ingestion outputs: rerun `pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested`, then `pnpm validate-ingestion` and `pnpm report:source-coverage`.
- Missing live provider credentials: deterministic fixture verification still passes; explicit `--provider openai` runs fail with sanitized missing-credential diagnostics.
- Malformed provider JSON, unknown source/entity/race IDs, or evidence quote mismatches: inspect `data/extracted/runs/latest.json` and `data/extracted/validation/latest.json`.
- Unsupported public positions, missing evidence, or source coverage mismatches: inspect `data/reviewed/position-coverage.json` and keep affected records hidden until the source boundary is fixed.
- Missing review or override files: rerun `prepare` and inspect path-qualified CLI output.
- Public loader returns no records after publish: confirm at least one reviewed position is `status: "verified"` or `"published"` and `publicationStatus: "public"`.

## Handoff to UI slices

UI slices should render and test only through public loaders over `data/public/` plus `manual/overrides/`. They should not read `data/extracted/` drafts or `manual/reviews/` staging files directly.

## Static inspection page

Run the Next app or static build and open `/review/races/{slug}`. The page summarizes the latest extraction run, review status, draft positions, evidence quotes, source/artifact/chunk IDs, and the CLI commands needed to publish. It is intentionally read-only because static export cannot write local files.
