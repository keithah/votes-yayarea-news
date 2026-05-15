# Local position review workflow

LLM extraction drafts are never public by themselves. The local review loop copies draft positions into editable JSON under `manual/reviews/races/`, then publishes only records that a reviewer explicitly marks ready.

## Commands

```bash
pnpm review:positions prepare --race-slug mayor
pnpm review:positions status --race-slug mayor
pnpm review:positions publish --race-slug mayor
```

- `prepare` reads `data/extracted/drafts/latest.json` and creates or updates `manual/reviews/races/{slug}.json`. New records start as `status: "draft"` and `publicationStatus: "hidden"`.
- `status` validates the review JSON and reports path-qualified readiness issues.
- `publish` merges only verified/published public review records into `manual/overrides/races/{slug}.json`, then runs the race loaders so invalid overrides fail before completion.

## Editing review JSON

For each position, inspect the label, rationale, evidence quotes, source IDs, artifact IDs, and chunk IDs. Then choose one of these outcomes:

- Keep private: leave `publicationStatus` as `hidden`.
- Reject: set `status` to `rejected` and keep `publicationStatus` as `hidden`.
- Publish: set `status` to `verified` (or `published`) and `publicationStatus` to `public`.

Published positions must keep at least one evidence record with a non-empty quote. Duplicate review IDs, malformed JSON, rejected public records, and evidence-less public records are rejected by `status`/`publish` diagnostics.

## Static inspection page

Run the Next app or static build and open `/review/races/{slug}`. The page summarizes the latest extraction run, review status, draft positions, evidence quotes, source/artifact/chunk IDs, and the CLI commands needed to publish. It is intentionally read-only because static export cannot write local files.
