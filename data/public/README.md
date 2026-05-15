# Public data contract

`data/public/` contains the canonical JSON records that can be used by static loaders and exported routes. The files in this directory are intentionally small, deterministic, and safe for build-time validation.

## Layout

- `sources.json` — public voter-guide, editorial, civic, advocacy, labor, party, and institutional sources.
- `entities.json` — candidates, measures, offices, organizations, or other things a race can reference.
- `collections.json` — launch collections and route groupings.
- `races/<slug>.json` — one race or ballot-measure record per stable race slug.
- `ballot-universe.json` — M002 tracked-contest manifest documenting official-data provenance and gaps.

## IDs and slugs

- IDs and slugs use lowercase kebab-case: `california-governor`, `src-sf-chronicle`, `ent-california-governor-xavier-becerra`.
- Slugs are stable URL-facing identifiers. Do not rename a slug after publication without a redirect plan.
- IDs are stable internal references. Every `sourceId`, `entityId`, `raceId`, and evidence link must resolve inside this public dataset.

## Static export constraints

- Validation and loaders must read only repository-owned JSON from `data/public/`.
- Public data files must not depend on `.gsd/`, `.planning/`, `.audits/`, network calls, local caches, or generated build output.
- Every failure should be reported with a file path or JSON path so static build failures are diagnosable.

## Review and publication rules

Production records must be source-backed and reviewed before public display. A position, summary, or race may be present as `draft`, but anything publicly visible must be reviewed/verified/published and include source-backed evidence. Historical fixtures must stay outside public launch data; do not add placeholder candidates, fixture guide URLs, or unsupported 2026 election claims to this directory.

## S04 extraction provenance and loader gating

LLM-generated extraction output is never a public loader input. Generated drafts live under `data/extracted/`, local review state lives under `manual/reviews/`, and the static public loaders read only canonical `data/public/` plus reviewed records copied into `manual/overrides/` by the review publish workflow.

Public loader visibility requires both gates:

- `status` is `verified` or `published`.
- `publicationStatus` is `public`.

Records that are only `reviewed`, still `draft`, or `verified` but `hidden` are filtered before public output. Summary and theme `evidenceIds` are also trimmed to evidence attached to positions that survived the public filter.

Evidence produced by the extraction review workflow carries optional provenance fields:

- `artifactId` — source artifact used during extraction.
- `chunkId` — source chunk containing the quoted evidence.

Canonical hand-authored evidence can omit those fields for compatibility. If public evidence includes either provenance field, validation requires both fields to be present and kebab-case so malformed or partially copied extraction evidence fails during the `merged` or `public-filter` loader phase instead of leaking downstream.
