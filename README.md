# votes.yayarea.news

Static-first election recommendation explorer for the June 2, 2026 San Francisco Consolidated Statewide Direct Primary Election.

The M001 launch wedge is a trustworthy public site that aggregates tracked voter guides, publications, clubs, civic organizations, advocacy groups, and similar public sources; shows where they agree or disagree; and links visible recommendations back to source receipts. It is an aggregator and explainer, not an endorsement product.

## Local commands

Use pnpm from the repository root.

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

Current scripts:

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the local Next.js development server. |
| `pnpm validate-data` | Validate committed public data and local manual overrides, printing checked files and deterministic collection counts. |
| `pnpm test:data` | Run data contract, loader, and debug-route tests. |
| `pnpm test:ingestion` | Run source-ingestion cleaner, chunker, runner, and validation tests. |
| `pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested` | Import representative fixture sources into raw captures, normalized artifacts, chunks, and run diagnostics. |
| `pnpm validate-ingestion` | Validate generated ingestion outputs and write `data/ingested/validation/latest.json`. |
| `pnpm extract:positions -- --provider fixture --race-slug mayor` | Run deterministic S04 position extraction over S03 artifacts/chunks and write hidden drafts plus run/validation diagnostics under `data/extracted/`. |
| `pnpm validate-extraction -- --race-slug mayor` | Revalidate persisted extraction drafts against public race data and S03 artifact/chunk provenance. |
| `pnpm review:positions prepare --race-slug mayor` | Stage hidden editable review JSON from extraction drafts under `manual/reviews/races/`. |
| `pnpm review:positions status --race-slug mayor` | Validate local review JSON readiness before publication. |
| `pnpm review:positions publish --race-slug mayor` | Publish only verified/public review records into `manual/overrides/races/` and exercise public loaders. |
| `pnpm typecheck` | Run TypeScript without emitting build output. |
| `pnpm build` | Build the static Next.js export. |
| `pnpm verify:s02` | Run the full S02 data skeleton verification, including static export checks for the sample mayor debug route. |
| `pnpm verify:s03` | Run the full S03 ingestion verification: ingestion tests, representative fixture ingestion, ingestion validation, public data validation, typecheck, static build, and generated diagnostics checks. |
| `pnpm verify:s04` | Run the full S04 extraction/review/publication verification: deterministic extraction, validation, review publish, public data validation, extraction/loader tests, typecheck, static build, and artifact coherence checks. |
| `pnpm verify:s05` | Run the full S05 public static UI verification: public data validation, data/UI route tests, typecheck, static build, and homepage-to-mayor export smoke checks. |
| `pnpm verify:s06` | Run the full S06 recommendation matrix verification: public data validation, matrix model and route tests, typecheck, static build, and mayor matrix HTML assertions. |
| `pnpm verify:s07` | Run the full S07 receipts, reviewed-summary, and AI disclosure verification: public data validation, data/model/route tests, typecheck, static build, and exported HTML assertions for receipt readiness, reviewed summary evidence, and footer disclosure reachability. |
| `pnpm verify:s08` | Run the full S08 entity/source drill-down verification: public data validation, data/model/route tests, typecheck, static build, and exported HTML assertions for entity pages, source pages, related links, public receipts, diagnostics, and footer disclosure reachability. |

## S02 data skeleton

The current data boundary is committed, local, and build-time only:

- `data/public/` contains canonical public JSON fixtures for sources, entities, collections, and race data.
- `manual/overrides/` contains local manual-review overrides that are merged after canonical validation.
- `lib/data/` contains the typed data contract, validator, and static loaders used by tests and routes.
- `pnpm validate-data` validates canonical fixtures and merged override output, printing checked paths plus source/entity/collection/race/position/evidence counts.
- `pnpm test:data` runs the data validator, loader, and debug-route tests.
- After `pnpm build`, `/debug/races/mayor/` is exported to `out/debug/races/mayor/index.html` as the sample race data debug page.

## S03 source ingestion

S03 adds a deterministic, auditable ingestion boundary before extraction. The representative source import is fixture-backed by default and does not require network access:

```bash
pnpm test:ingestion
pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested
pnpm validate-ingestion
pnpm verify:s03
```

Generated ingestion output lives under `data/ingested/`:

- `raw/*.html` preserves the original fixture or fetched body for audit and manual fallback.
- `artifacts/*.json` stores normalized clean text plus source, artifact, raw, and chunk references.
- `chunks/*.json` stores deterministic extraction units with stable chunk IDs and source/artifact references.
- `runs/latest.json` records the latest ingestion run with phase, status, source, artifact, count, and issue diagnostics.
- `validation/latest.json` records checked files, deterministic counts, and path-qualified validation issues.

The fixtures in `data/ingestion/fixtures/` are representative samples only. They are committed to keep tests and `pnpm verify:s03` repeatable; they are not official 2026 election claims or endorsements. URL ingestion is opt-in with `--allow-network`, and fetched output should be treated as volatile until `pnpm validate-ingestion` passes and the diagnostics are reviewed.

### S04 extraction handoff

S04 extraction should read the normalized boundary produced by S03:

- read source-level clean text from `data/ingested/artifacts/*.json`;
- read extraction units from `data/ingested/chunks/*.json`;
- use `data/ingested/raw/*.html` only for audit, debugging, or manual fallback.

Extraction must not scrape raw external pages at runtime or bypass the generated artifact/chunk contract. Before S04 starts, run `pnpm verify:s03` or at minimum `pnpm validate-ingestion` and proceed only when `data/ingested/validation/latest.json` reports `ok: true` and `counts.errors: 0`.

### S04 extraction and review

S04 turns S03 artifacts/chunks into evidence-linked position drafts, then requires local human review before anything can affect public loaders. The deterministic closeout command is:

```bash
pnpm verify:s04
```

`pnpm verify:s04` is local and network-free by default. It runs fixture extraction for `mayor`, writes `data/extracted/drafts/latest.json`, `data/extracted/runs/latest.json`, and `data/extracted/validation/latest.json`, prepares `manual/reviews/races/mayor.json`, marks the representative sample records verified/public for the verifier fixture, publishes them into `manual/overrides/races/mayor.json`, validates public data, runs extraction and loader integration tests, typechecks, builds, and asserts output JSON status/count coherence.

For day-to-day operation, use the same steps manually when you do not want the verifier to update the sample review/override files:

```bash
pnpm extract:positions -- --provider fixture --race-slug mayor
pnpm validate-extraction -- --race-slug mayor
pnpm review:positions prepare --race-slug mayor
pnpm review:positions status --race-slug mayor
# edit manual/reviews/races/mayor.json: set reviewed records to status verified/published and publicationStatus public
pnpm review:positions publish --race-slug mayor
pnpm validate-data
```

Live LLM extraction is opt-in and should only be used when `OPENAI_API_KEY` is available in the environment. The operational demo command is:

```bash
pnpm extract:positions -- --provider openai --model gpt-4o-mini --race-slug mayor
```

Live failures are expected to fail closed with sanitized diagnostics in `data/extracted/runs/latest.json` and `data/extracted/validation/latest.json`; API keys, request headers, and raw secret-bearing provider responses must not be printed or persisted. Generated drafts and `manual/reviews/` files are never public loader inputs. Public pages see extraction output only after `review:positions publish` copies verified/public records into `manual/overrides/races/` and `pnpm validate-data`/loader tests pass.

Common failure modes:

- Missing S03 artifacts/chunks: rerun `pnpm ingest:sources -- --manifest data/ingestion/manifest.json --out data/ingested`, then `pnpm validate-ingestion`.
- Malformed provider JSON or source/entity/race mismatches: inspect path-qualified issues in `data/extracted/runs/latest.json` and `data/extracted/validation/latest.json`.
- Missing evidence quotes or chunk provenance: fix the extraction/review record; public validation rejects evidence without required source/artifact/chunk linkage.
- Publication validation failures: inspect `pnpm review:positions publish --race-slug mayor` output and `manual/reviews/races/mayor.json` before changing overrides directly.

S05 should consume only the validated public-loader surface (`data/public/` plus `manual/overrides/`), not hidden extraction drafts or review staging files.

### S05 public static UI

S05 renders the first public-facing static UI layer: the homepage, public race route shell, visible consensus/source-type counts, theme-aware styling, and clearly labeled placeholders for later matrix, receipts, AI disclosure, and drill-down surfaces. The closeout command is:

```bash
pnpm verify:s05
```

`pnpm verify:s05` is local, credential-free, and network-free. It validates public data, runs the data and public route model tests (including unknown slug and zero-position boundaries), typechecks, builds the static export, and asserts that both `out/index.html` and `out/races/mayor/index.html` contain the expected public UI shell text.

Expected browser smoke path after `pnpm build` or `pnpm verify:s05`:

1. Open `/` and confirm the homepage lists the San Francisco Mayor public race card with source/evidence/candidate counts.
2. Follow the Mayor card to `/races/mayor/`.
3. Confirm the race page shows the race header, consensus snapshot, source-type breakdown, candidate/source modules, light/dark theme styling, and placeholders for comparison matrix, receipts drawer, AI disclosure, and future drill-down pages.

These S05 placeholders are intentional. They prove data is available for later slices without claiming the S06 matrix, S07 receipts, AI disclosure page, or entity/source drill-down pages are complete.

### S06 recommendation matrix

S06 replaces the S05 comparison-matrix placeholder with a static-export-compatible recommendation matrix. The closeout command is:

```bash
pnpm verify:s06
```

`pnpm verify:s06` is local, credential-free, and network-free. It prints each verification phase before running it, stops at the first failing phase, and runs public data validation, data/model/route tests, TypeScript typecheck, the static Next.js build, and `scripts/assert-s06-export.mjs` against the exported mayor race page.

The export assertions intentionally check the user-visible and diagnostic contract rather than implementation internals: the matrix heading, desktop table and caption, presentation controls, mobile recommendation card labels, source-type grouping, neutral `No public position` missing-cell copy, evidence count text, stable matrix cell attributes, and absence of the old S05 placeholder copy.

Expected browser smoke path after `pnpm build` or `pnpm verify:s06`:

1. Open `/races/mayor/`.
2. Confirm the recommendation matrix shows the source-by-candidate heading and presentation controls for source type, candidate focus, position focus, sorting, and grouping.
3. On desktop width, confirm the table groups rows by source type and includes explicit neutral cells for source/candidate pairs with no public position.
4. On mobile width, confirm candidate cards stack source cards with source labels, position badges, and evidence counts.

### S07 receipts, reviewed summary, and AI disclosure

S07 adds public, static-export-compatible evidence receipts, reviewed AI summary support, and the `/how-we-use-ai` disclosure route. The closeout command is:

```bash
pnpm verify:s07
```

`pnpm verify:s07` is local, credential-free, and network-free. It prints each verification phase before running it, stops at the first failing phase, and runs public data validation, data/model/route tests, TypeScript typecheck, the static Next.js build, and `scripts/assert-s07-export.mjs` against the exported mayor race page plus AI disclosure page.

The export assertions intentionally check both inclusions and exclusions. They verify receipt readiness diagnostics on matrix cells (`data-receipt-status`, receipt counts, selected-cell default, empty reasons, and public source links), reviewed summary expansion/supporting evidence diagnostics (`data-summary-*` attributes, quotes, source/status metadata, and supporting-source links), footer reachability for `/how-we-use-ai/`, the disclosure route marker and sections, absence of old receipt/summary/disclosure placeholder copy, and absence of `.gsd` private path leakage.

Expected browser smoke path after `pnpm build` or `pnpm verify:s07`:

1. Open `/races/mayor/` and click a matrix cell that says it can open an evidence receipt.
2. Confirm the receipt drawer shows the candidate, source, position, status, quote, source link, and review/publication status.
3. Expand the reviewed AI summary and confirm supporting evidence quotes and links are visible.
4. Use the footer link to open `/how-we-use-ai/` and confirm the AI assistance, human review, automation boundary, evidence, publication gate, limitations, and corrections sections are present.

### S08 entity and source drill-downs

S08 adds static, public-only entity and source drill-down pages and links representative race cards to those routes. The closeout command is:

```bash
pnpm verify:s08
```

`pnpm verify:s08` is local, credential-free, and network-free. It prints each verification phase before running it, stops at the first failing phase, and runs public data validation, data/model/route tests, TypeScript typecheck, the static Next.js build, and `scripts/assert-s08-export.mjs` against the exported sample candidate entity page, San Francisco Chronicle source page, and mayor race page.

The export assertions intentionally check route-level diagnostics and public trust signals rather than implementation internals. They verify entity/source headings, recommendation/evidence counts, checked-file diagnostics, verified/public recommendation receipt attributes, evidence quotes and source URLs, related race/source/entity links, race-page drill-down links, `/how-we-use-ai/` footer reachability, absence of stale drill-down placeholder copy, and absence of `.gsd` private path leakage.

Expected browser smoke path after `pnpm build` or `pnpm verify:s08`:

1. Open `/races/mayor/` and follow the Sample Candidate A link to `/entities/sample-candidate-a/`.
2. Confirm the entity page shows public recommendation counts, related race/source links, verified public recommendation receipts, evidence quotes, source URLs, and visible diagnostics.
3. Return to `/races/mayor/` and follow the San Francisco Chronicle source page link to `/sources/san-francisco-chronicle-editorial-board/`.
4. Confirm the source page shows related races/entities, verified public recommendation receipts, evidence quotes, public source URLs, visible diagnostics, and the footer disclosure link.

## Static-export constraints

M001 keeps Next.js static export (`output: 'export'`) for launch. That means:

- no required production database;
- no production CMS dependency;
- no required runtime Next.js server;
- no API routes as a core public-site dependency;
- no runtime scraping or extraction;
- no dynamic per-request recommendation computation.

Data ingestion, extraction, manual review, validation, and overrides must happen before build time. The public app should consume only committed, validated, publishable data and render static pages that can be hosted on a simple static host.

If server-only capabilities become necessary later, the escape hatch is documented in [`decisions/framework.md`](./decisions/framework.md): remove static export, choose a runtime host, and migrate route-by-route while preserving committed data/review files as the source of truth until a deliberate backend replacement exists.

## Launch decision index

Read [`decisions/README.md`](./decisions/README.md) before changing source scope, race scope, framework/deploy assumptions, or launch cutline behavior.

Key launch decisions:

- [`decisions/sources.md`](./decisions/sources.md) locks the v1 source universe and inclusion/exclusion rules.
- [`decisions/races.md`](./decisions/races.md) locks the v1 race universe, route slugs, and ship/conditional/cut flags.
- [`decisions/framework.md`](./decisions/framework.md) records why M001 stays on Next.js static export.

## M001 cutline

### Never cut

These items are required for a trustworthy launch:

- homepage and supported race pages;
- San Francisco Mayor race support;
- local ballot measures support;
- data-completeness notes for every visible race;
- verified or published recommendation records only;
- source links and receipt evidence for every visible recommendation;
- recommendation matrix or equivalent comparison surface;
- AI disclosure and `/how-we-use-ai` access from the public site;
- human review before any AI-generated summary is visible;
- non-endorsement copy that avoids telling users how to vote;
- static build/typecheck passing before launch claims.

### Cut or defer first

These can be removed from launch scope if the core trust loop is at risk:

- share cards;
- advanced filters;
- launch-supported source/entity pages beyond what core navigation needs;
- lower-coverage conditional races;
- party committee, judicial, or other `Cut/defer` races unless later data coverage makes them cheap and trustworthy.

## Trust and language rules

The product reports what tracked sources recommend and why. It must not make its own voting recommendations or use phrases such as “best candidate,” “top choice,” “you should vote for,” or “our pick.”

Visible recommendation and AI-summary content must be evidence-linked, human-reviewed, and clear about data completeness. Incomplete races should be labeled as incomplete or hidden rather than shown as finished.

## Launch checklist for future slices

Before calling M001 launch-ready, verify that:

- locked source and race lists still match the data/routes being rendered;
- every visible recommendation has a working source URL and evidence record;
- only `verified` or `published` records appear in production loaders;
- AI summaries are collapsed by default, labeled as AI-generated, evidence-linked, and human-reviewed;
- `/how-we-use-ai` is reachable from every page footer;
- mobile homepage and representative race page performance meet the milestone target;
- matrix states work in light and dark themes and do not rely on color alone;
- public copy passes the endorsement-language guard once that script exists;
- `pnpm typecheck` and `pnpm build` pass.
