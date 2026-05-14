# Decisions Index

This directory contains the launch-scope decisions that later M001 slices should treat as the starting contract for `votes.yayarea.news`.

## Read first

| Decision file | What it locks | Who needs it |
|---|---|---|
| [`sources.md`](./sources.md) | The M001 v1 public-source universe, inclusion/exclusion rules, pending guide URL policy, and S03 ingestion notes. | Source ingestion, extraction, manual review, validation, and launch QA agents. |
| [`races.md`](./races.md) | The M001 v1 race/contest universe, route slugs, ship/conditional/cut flags, and data-completeness expectations. | Data schema, route generation, UI, validation, and launch cutline agents. |
| [`framework.md`](./framework.md) | The decision to keep Next.js static export for M001 and avoid production runtime/database/CMS dependencies. | App scaffold, build/deploy, data-loader, and architecture agents. |

## Current locked launch decisions

- Launch source scope is category-based and receipt-oriented. Guide URLs and publication dates may remain `pending` until real 2026 artifacts are found; do not invent metadata.
- Launch race scope prioritizes San Francisco Mayor and local ballot measures, with other races gated by ballot presence and source coverage.
- Public race pages must show data-completeness state and must never present unsupported or unreviewed recommendation data as complete.
- The app remains a static-export Next.js site for M001. Ingestion, extraction, review, validation, and overrides happen before build time; the public app consumes committed publishable data.

## How to change a decision later

These files are launch-scope contracts, not casual notes. If a later slice needs to change one:

1. Record why the existing decision is insufficient.
2. Add a superseding decision or clearly marked update rather than silently deleting launch context.
3. Update any affected README/checklist references.
4. Re-run the relevant validation/build checks before claiming the change is safe.
