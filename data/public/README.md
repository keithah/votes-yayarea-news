# Public data contract

`data/public/` contains the canonical JSON records that can be used by static loaders and exported routes. The files in this directory are intentionally small, deterministic, and safe for build-time validation.

## Layout

- `sources.json` — public voter-guide, editorial, civic, advocacy, labor, party, and institutional sources.
- `entities.json` — candidates, measures, offices, organizations, or other things a race can reference.
- `collections.json` — launch collections and route groupings.
- `races/<slug>.json` — one race or ballot-measure record per stable race slug.

## IDs and slugs

- IDs and slugs use lowercase kebab-case: `mayor`, `src-sf-chronicle`, `ent-sample-candidate-a`.
- Slugs are stable URL-facing identifiers. Do not rename a slug after publication without a redirect plan.
- IDs are stable internal references. Every `sourceId`, `entityId`, `raceId`, and evidence link must resolve inside this public dataset.

## Static export constraints

- Validation and loaders must read only repository-owned JSON from `data/public/`.
- Public data files must not depend on `.gsd/`, `.planning/`, `.audits/`, network calls, local caches, or generated build output.
- Every failure should be reported with a file path or JSON path so static build failures are diagnosable.

## Review and publication rules

Production records must be source-backed and reviewed before public display. A position, summary, or race may be present as `draft`, but anything publicly visible must be reviewed/verified/published and include source-backed evidence. Sample fixture records in this repository are explicitly marked with `sampleFixture: true` and are not official 2026 election claims.
