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
| `pnpm typecheck` | Run TypeScript without emitting build output. |
| `pnpm build` | Build the static Next.js export. |
| `pnpm verify:s02` | Run the full S02 data skeleton verification, including static export checks for the sample mayor debug route. |

## S02 data skeleton

The current data boundary is committed, local, and build-time only:

- `data/public/` contains canonical public JSON fixtures for sources, entities, collections, and race data.
- `manual/overrides/` contains local manual-review overrides that are merged after canonical validation.
- `lib/data/` contains the typed data contract, validator, and static loaders used by tests and routes.
- `pnpm validate-data` validates canonical fixtures and merged override output, printing checked paths plus source/entity/collection/race/position/evidence counts.
- `pnpm test:data` runs the data validator, loader, and debug-route tests.
- After `pnpm build`, `/debug/races/mayor/` is exported to `out/debug/races/mayor/index.html` as the sample race data debug page.

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
