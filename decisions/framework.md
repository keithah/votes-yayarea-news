# Framework Decision: Next.js Static Export

## Decision

Keep `votes.yayarea.news` on **Next.js with static export** for M001.

The current repository already matches this choice:

- `package.json` defines the app as a private static Next.js site for `votes.yayarea.news`.
- `next.config.mjs` sets `output: 'export'`, which makes `next build` emit static files instead of requiring a runtime Next.js server.
- `next.config.mjs` also sets `trailingSlash: true`, which is compatible with simple static hosts and directory-style routes.

## Why this fits M001

M001 is a static-first, GitHub-native launch. The product needs race pages, recommendation matrices, receipts, AI disclosure, and review-gated data rendered from committed files without introducing a production database, CMS, user accounts, or server operations before launch.

Next.js static export gives the repo a familiar React/TypeScript app model while preserving the operational simplicity of a static site:

- build-time route generation for locked launch races;
- committed JSON/Markdown data as the source of truth;
- static hosting portability across GitHub Pages, Cloudflare Pages, Netlify, Vercel static output, or similar hosts;
- low runtime failure surface because there is no required production Node server;
- strong mobile performance potential because race pages can be pre-rendered and aggressively cached.

## Alternatives considered

### Database-backed Next.js app

Rejected for M001. It would support richer admin workflows later, but adds production database operations, auth, migrations, runtime failure modes, and a larger review system before the launch wedge proves demand.

### CMS-backed site

Rejected for M001. A CMS could make editing friendlier, but it would split the source of truth away from the repository and complicate the explicit review, override, and audit trail requirements.

### Fully manual static HTML

Rejected for M001. It would be fast for a narrow demo, but would not prove the reusable data, evidence, review-gating, and static-route primitives needed for the broader yayarea.news model.

### Astro or another static site generator

Deferred. Astro is a strong fit for content-heavy static sites, but the current repo is already a Next.js/React/TypeScript scaffold and the milestone includes interactive UI surfaces such as the recommendation matrix, receipts drawer, theme behavior, and analytics smoke checks.

## Constraints intentionally avoided

For launch, the framework choice avoids requiring:

- a production database;
- server-side rendering infrastructure;
- API routes as a core production dependency;
- user accounts or authenticated admin surfaces;
- a CMS deployment;
- runtime scraping or extraction;
- dynamic per-request recommendation computation.

Data ingestion, extraction, review, validation, and manual overrides should happen before build time. The public app should consume only validated, publishable static data.

## Mobile performance rationale

Mobile performance is a milestone acceptance criterion. Static export supports the target by letting the app pre-render pages, serve cacheable assets, avoid database/API round trips on first view, and keep the client bundle focused on the interactive surfaces that actually need JavaScript, such as matrix controls and receipt drawers.

Implementation should continue to treat mobile performance as a constraint: avoid shipping extraction/admin code to the browser, keep data payloads race-scoped where possible, prefer accessible HTML before client-only widgets, and verify representative pages with build and Lighthouse checks before launch.

## Revert or migration plan

If M001 later requires server-only capabilities, remove `output: 'export'` from `next.config.mjs`, choose a runtime host, and migrate one route at a time while keeping the committed data/review files as the canonical source of truth until a replacement backend is deliberately adopted.
