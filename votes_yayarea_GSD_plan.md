# votes.yayarea.news — GSD Plan

_Source: `votes_yayarea_product_design_spec.md` v1_

This plan structures launch work into one milestone (the public v1 launch) with nine slices that mirror the spec's Day 1–7 plan plus the cutline priorities. Later slices are marked `[sketch]` where progressive planning makes sense — they have approved scope and demo lines but full task plans should be expanded via `refine-slice` once their prior slice's summary is in hand.

---

## Milestone M001 — Public Launch v1

**Shippable version:** `votes.yayarea.news` live, covering the June 2, 2026 SF Primary, with the never-cut items from §20 (source links, AI disclosure, manual review, data completeness notes) present and every visible AI summary human-reviewed.

**Demo line:** A normal SF voter lands on the site, picks the Mayor race, sees a consensus snapshot in under 30 seconds, opens the matrix, clicks a cell, reads the source quote, follows the link to the original voter guide.

**Success criteria (checked at Validate Milestone):**

- Race pages render for every race in the locked race list with at least the minimum source count.
- Every AI summary visible on production has `status: verified` or `published`.
- Every visible recommendation has at least one Evidence record with a working source URL.
- `/how-we-use-ai` is reachable from every page footer.
- Lighthouse mobile performance ≥ 85 on the homepage and a representative race page.
- Dark and light modes both render without contrast failures on the matrix.
- Analytics fires on race page view, matrix open, AI summary expand, and receipt drawer open.

**Slices (9):**

1. S001 — Scope lock & foundation
2. S002 — Data schema & static repo skeleton
3. S003 — Source ingestion pipeline (scrape → artifact → chunk)
4. S004 — Position extraction & manual review loop
5. S005 — Core UI: homepage + race page shell + consensus meter
6. S006 — Recommendation matrix (desktop + mobile)
7. S007 — Evidence/receipts drawer + AI summaries + `/how-we-use-ai` `[sketch]`
8. S008 — Entity, source, and supporting pages `[sketch]`
9. S009 — QA, share cards, analytics, deploy `[sketch]`

---

## Slice S001 — Scope lock & foundation

**Demo:** Open the repo's `README.md` and `/decisions/` directory. Locked source list, locked race list, picked static-site framework, and a running `pnpm dev` (or equivalent) showing a blank page at `localhost`.

**Scope boundary:** No data ingestion, no UI components yet. This slice ends when scope is frozen and the framework is bootable.

**Tasks:**

- **T001.1 — Lock the source list.** Produce `/decisions/sources.md` enumerating the initial sources by §8.6 category. Must-haves: every entry has name, category, guide URL, publication date (or "pending"), and source type; ≥ 2 sources per active category or an explicit note that a category is excluded for v1.
- **T001.2 — Lock the race list.** Produce `/decisions/races.md` ordered by the §8.4 priority. Must-haves: every race has slug, type, candidate/option count if known, and a "ship/cut" flag matching the §20 cutline.
- **T001.3 — Pick the static-site framework.** Research Next.js static export vs Astro vs Vite-React-SSG against the static-first constraints in §11. Produce `/decisions/framework.md` with a one-paragraph rationale and a one-line revert plan. Must-haves: decision recorded, bundler choice justified against mobile Lighthouse target ≥ 85.
- **T001.4 — Bootstrap the repo.** Initialize the chosen framework, the repo layout from §11.3, lint, typecheck, and a placeholder homepage. Must-haves: `pnpm install && pnpm build && pnpm dev` all succeed; lint and typecheck pass on a clean checkout; `/data`, `/manual`, `/scripts`, `/site` directories exist.
- **T001.5 — Set up the launch checklist & decision log.** Create `/decisions/README.md` indexing the three decisions above and `MILESTONE-M001-ROADMAP.md` summarizing this plan. Must-haves: roadmap file committed, cutline copy from §20 included.

---

## Slice S002 — Data schema & static repo skeleton

**Demo:** Run `pnpm validate-data` against committed sample JSON for one source, one artifact, one race, two candidates, two positions, and two evidence records. Validation passes. Open the sample race page route and see the raw data echoed in a debug component.

**Scope boundary:** Schemas + sample fixtures + a route that loads them. No real source data yet, no real UI styling.

**Tasks:**

- **T002.1 — Implement TypeScript types from §10.2.** Create `/site/types/` with `Source`, `Artifact`, `ArtifactChunk`, `Entity`, `Collection`, `Position`, `PositionType`, `Evidence`, `Theme`, `Summary`, `Embedding`, `ExtractionRun`, `ReviewStatus`. Must-haves: `tsc --noEmit` passes; every type matches the spec field-for-field.
- **T002.2 — Write JSON schemas + a validator.** Generate JSON Schema from the TS types or hand-write Zod schemas mirroring them. Add a `pnpm validate-data` script that walks `/data` and fails on any invalid file. Must-haves: validator exits non-zero on a deliberately broken fixture in tests; passes on the canonical fixture.
- **T002.3 — Author canonical sample fixtures.** Fill `/data` with one fully-populated example per object type for one fake race (e.g., "Sample Supervisor District 99"). Must-haves: validator passes; every cross-reference (e.g., `Position.evidenceIds`) resolves to an existing record.
- **T002.4 — Build the data loader.** Implement a build-time loader that reads `/data`, applies `/manual/overrides.json`, and exposes a typed query API (e.g., `getRace(slug)`, `getPositionsForRace(slug)`). Must-haves: unit test covers override precedence (per §11.4 "manual data should always win"); loader runs at build time only, no client-side fetches.
- **T002.5 — Wire the debug race route.** Create `/races/[slug]` that uses the loader to render the sample race's raw data as a pre-formatted JSON dump behind a `?debug=1` flag. Must-haves: route builds statically; debug flag gated so it does not leak in production builds.

---

## Slice S003 — Source ingestion pipeline (scrape → artifact → chunk)

**Demo:** Run `pnpm ingest sources/growsf.json` (or similar). The script fetches the guide URL, captures raw HTML to disk, extracts text into an `Artifact`, chunks it into `ArtifactChunk` records, and commits the result. Open the resulting artifact file and see clean text.

**Scope boundary:** Only the scrape → artifact → chunk portion of the §11.5 pipeline. No LLM extraction, no embeddings. Two to three real sources end-to-end is enough to prove the pipeline.

**Tasks:**

- **T003.1 — Implement the scraper.** Build `/scripts/scrape.ts` taking a source JSON and producing raw HTML + captured-at metadata. Must-haves: respects robots.txt; user-agent identifies the project; saves raw HTML to `/data/artifacts/raw/` (gitignored) and a content hash to the artifact record; fails loudly on 4xx/5xx.
- **T003.2 — Implement text extraction.** Build `/scripts/extract-text.ts` converting raw HTML/PDF to clean text using Readability + a PDF fallback. Must-haves: produces `Artifact.rawText`; strips nav/footer boilerplate verified on 2+ real sources; preserves paragraph breaks.
- **T003.3 — Implement chunking.** Build chunking logic that produces `ArtifactChunk` records with stable indices and offsets. Must-haves: chunk size targets the embedding model's context; offsets round-trip (`rawText.slice(start, end) === chunk.text`); deterministic across runs given the same input.
- **T003.4 — Run the pipeline on 2–3 real sources.** Pick from the locked source list, run end-to-end, commit the resulting JSON. Must-haves: validator still passes; each artifact has ≥ 1 chunk; manual spot-check confirms the text is readable.
- **T003.5 — Document the failure modes.** Write `/scripts/README.md` covering known fragile sources, PDF gotchas, and the manual-override escape hatch from §11.4. Must-haves: every source that failed in T003.4 has a documented workaround or is explicitly listed as "manual-only for v1".

---

## Slice S004 — Position extraction & manual review loop

**Demo:** Run `pnpm extract positions` against the artifacts from S003. Open the produced `/data/positions/<race>.json`, see structured `Position` records with `confidence` and `evidenceIds`. Open `/manual/overrides.json` and demonstrate that a correction there wins on the next build.

**Scope boundary:** Extract positions + evidence, run them through Keith's review path. No themes, no AI summaries, no embeddings yet. The review path can be JSON-PR-based per §14.1.

**Tasks:**

- **T004.1 — Author the extraction prompt.** Encode the §13.3 prompt constraints (use only provided text, no inference beyond text, return uncertainty, include evidence IDs). Version it in `/scripts/prompts/extract-positions.v1.md`. Must-haves: prompt file committed; includes explicit refusal instruction for missing evidence; ExtractionRun records `promptVersion`.
- **T004.2 — Implement the position extractor.** Build `/scripts/extract-positions.ts` that takes artifacts + chunks and produces `Position` + `Evidence` records with `status: needs_review`. Must-haves: every Position has ≥ 1 Evidence; ExtractionRun records `model`, `promptVersion`, `codeVersion`, `status`; deterministic temperature 0 or explicit seed.
- **T004.3 — Implement the manual-override layer.** Extend the loader from T002.4 so `/manual/overrides.json` can: edit recommendation type, fix entity mapping, attach/edit evidence quote, toggle published status (per §14.2). Must-haves: unit test for each override action; override always wins over extracted value; `tsc --noEmit` passes.
- **T004.4 — Add review-status gating to the loader.** The frontend loader must return only `verified` or `published` records by default (per §14.3). A `?preview=1` build flag may include `needs_review`. Must-haves: unit test confirms `draft`/`needs_review`/`rejected` are filtered in production builds.
- **T004.5 — Run extraction across all S003 artifacts and review.** Run the pipeline, manually review a sample, commit overrides as needed, mark reviewed records as `verified`. Must-haves: at least one race has ≥ 3 sources with `verified` positions and evidence end-to-end.

---

## Slice S005 — Core UI: homepage + race page shell + consensus meter

**Demo:** Visit `/`. See the hero, election status banner, featured races, most unified, most divided, latest recommendations, source explorer. Click into the Mayor race. See the race header, consensus snapshot with the source-type breakdown table, and placeholders for matrix + receipts.

**Scope boundary:** Layout, hero, consensus meter math, race header. No matrix yet (S006), no AI summaries yet (S007). Both light and dark mode must work; aim for the §6.2 polish bar.

**Tasks:**

- **T005.1 — Design tokens & theme system.** Set up CSS variables, font stack, source-category colors, light/dark mode toggle. Must-haves: theme toggle persists across navigation; AA contrast on category colors verified; tokens documented in `/site/styles/README.md`.
- **T005.2 — Build the homepage.** Implement hero, election status banner, featured-races cards, most-unified, most-divided, latest-recommendations, source-explorer grid (§9.1). Must-haves: all modules render from real data only; no lorem ipsum on a production build; mobile layout verified at 375px.
- **T005.3 — Build the race page shell.** Implement Section A (race header) and the scaffolding for B–F per §9.2. Must-haves: race header shows race name, election date, candidate count, source count, last-updated, data-completeness status; sections B–F have visible "coming next" placeholders that do not look broken.
- **T005.4 — Implement the consensus meter (§16).** Compute "Most recommended", "Recommended by X of Y sources", source-type breakdown table. Must-haves: math verified by unit test against a fixture; copy follows §16.2 (no "winner"/"best"/"top candidate"); breakdown table renders on mobile without overflow.
- **T005.5 — Wire the §5.1 language guard.** Add a build-time check that scans rendered text and fails the build on a configurable banned-phrase list ("best candidate", "top choice", "you should vote for", "strongest candidate"). Must-haves: check runs in CI; failing fixture proves it catches violations.

---

## Slice S006 — Recommendation matrix (desktop + mobile)

**Demo:** On the Mayor race page, the matrix renders with sources as rows and candidates as columns. Cells use pills + symbols per §15.3. Hover a cell to see the source quote. Filter by source type. Toggle "group by source type". Open the same page on mobile and see the stacked-card view from §15.4.

**Scope boundary:** The matrix itself + its mobile alternate + filters/toggles. Receipts drawer is S007.

**Tasks:**

- **T006.1 — Design the cell visual language.** Pills + symbols mapping the §15.3 UI states (Recommended / Secondary / Opposed / Informational / No position) to internal `PositionType`s. Must-haves: every PositionType from §10.2 maps to exactly one UI state; symbols meet the §15.3 "do not rely only on color" rule.
- **T006.2 — Implement the desktop matrix.** Render rows × columns from real position data, with the default "recommendation similarity" sort from §15.2. Must-haves: similarity sort verified by a unit test on a fixture; renders without horizontal scroll on a 1280px viewport for a race with up to 9 candidates and 21 sources; empty cells visually distinct from "No position".
- **T006.3 — Implement filters and toggles.** Source-type filter, group-by-source-type toggle, alphabetical sort, recently-updated sort. Must-haves: each control has a visible active state; filter state preserved within a page session; tab/keyboard navigation works.
- **T006.4 — Implement the mobile stacked-card view.** Per §15.4: candidate name, recommendation count, source-type breakdown, expandable source list, plus an "Open full matrix" affordance. Must-haves: works at 375px and 768px without layout shift; expand/collapse keyboard-accessible.
- **T006.5 — Performance pass on the matrix.** Verify Lighthouse mobile performance ≥ 85 on a representative race page with a full matrix. Must-haves: numbers recorded; any regression vs S005 baseline documented and either fixed or accepted with a written rationale.

---

## Slice S007 — Receipts drawer + AI summaries + `/how-we-use-ai` `[sketch]`

**Demo:** Click any matrix cell. The receipts drawer slides in showing source name, recommendation, quote, link to the original guide, publication date, verification status. On the race page, click "Show AI-generated summary"; the drawer expands per §9.2 Section C with themes, supporting quotes, and the disclosure. Visit `/how-we-use-ai` and see the §9.5 page.

**Scope boundary:** Receipts UI, AI summary UI + the underlying theme/summary generation, and the disclosure page. Embeddings used only as infrastructure per §12.

**Dependencies on prior summaries:** Cell visual language (S006), Position+Evidence pipeline (S004), language guard (S005).

**Sketch notes for `refine-slice`:** Decide before expanding whether theme clustering uses an LLM-only path or embeddings + LLM. The §12 rules constrain the choice — embeddings are allowed for clustering evidence into themes but never for ranking or weighting. Also decide whether AI summaries are generated per race only, or also per entity (§9.3 "Why Sources Recommend This Candidate/Option"); the cutline allows deferring the entity-level summary.

---

## Slice S008 — Entity, source, and supporting pages `[sketch]`

**Demo:** Visit `/entities/[candidate-slug]` for a sample candidate and see the §9.3 sections: header, recommendation overview, "why sources recommend", source recommendations list, mini matrix context. Visit `/sources/[source-slug]` for a sample source and see the §9.4 layout. Related-pages links from S005's race page now resolve.

**Scope boundary:** Entity page template + source page template + related-links wiring. Excludes the §9.4 MVP exclusions (ideology labels, historical drift).

**Dependencies on prior summaries:** Race page shell and consensus meter math (S005) are likely reusable; entity-level AI summary depends on the path chosen in S007.

**Sketch notes for `refine-slice`:** If S007 deferred entity-level AI summaries, this slice may also defer them and instead show only the recommendation overview + source-recommendations list, leaving the "why sources recommend" section as a "coming soon" affordance gated behind a `[sketch]` follow-up. Reassess after S007's summary lands.

---

## Slice S009 — QA, share cards, analytics, deploy `[sketch]`

**Demo:** All §20 "never cut" items verified on production. Share-card images render for every race at `og-image` endpoints and look correct when previewed in a social-card debugger. Analytics events fire in a test deploy. Public DNS points at the production deploy.

**Scope boundary:** QA pass, share cards (§17), analytics (§18), and the actual deploy. This is the §19 Day 6–7 work consolidated.

**Dependencies on prior summaries:** Needs every visible UI surface (S005–S008) frozen enough for the QA matrix.

**Sketch notes for `refine-slice`:** Share-card types from §17.1 (race consensus / most divided / matrix screenshot / source breakdown) are cutline-eligible — the matrix screenshot card is the highest-leverage one for social and should be the first task if time is tight. Analytics tool choice between Plausible / PostHog / Umami (§18) should be decided in the first task here; defer creepy-tracking-adjacent features. Final QA must include the §20 "never cut" checklist (source links, AI disclosure, manual review, data completeness notes) as a hard gate before deploy.

---

## Cross-cutting notes

**Verification commands per task close-out.** Every task in S001–S009 should have, at minimum: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and (where data is touched) `pnpm validate-data`. Add `pnpm check-language` (the §5.1 banned-phrase guard) starting in S005.

**Open spec questions still alive at planning time** (from §21 — resolve during the relevant slice, do not block planning):

- Exact initial source list → resolved in T001.1.
- Exact race list → resolved in T001.2.
- Default dark vs light theme → resolved in T005.1.
- Final source-category colors → resolved in T005.1.
- Matrix cell visual (icons / pills / both) → resolved in T006.1.
- Race-completeness threshold → resolved during S004 review pass.
- Whether to ship incomplete races → resolved at Validate Milestone, informed by S009 QA.

**Cutline behavior at Reassess.** If S001–S006 run long, the natural cut order from §20 is: share cards first (defer to post-launch), then advanced filters (drop to a minimal source-type filter only), then source pages (defer to post-launch with a redirect). Race pages, consensus meter, matrix, receipts, AI disclosure, and homepage are never cut.

**Validate Milestone gate.** Before sealing M001, reconcile the success-criteria checklist at the top of this file against the actual production build. If any of the never-cut items fail, the milestone does not seal — open a hotfix slice instead of shipping.
