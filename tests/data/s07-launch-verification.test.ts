import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore JS launch-gate helpers are exercised through node --import tsx tests.
import { validateS07ExportReport } from "../../scripts/assert-s07-export.mjs";
// @ts-ignore JS launch-gate helpers are exercised through node --import tsx tests.
import { validateS07StaticSmokeReport } from "../../scripts/smoke-s07-static-export.mjs";
// @ts-ignore JS launch-verification helpers are exercised through node --import tsx tests.
import {
  FINAL_REPORT_PATH,
  LAUNCH_EXPORT_PATH,
  PAGES_PROOF_PATH,
  S07_REPORT_PATH,
  STATIC_SMOKE_PATH,
  createS07LaunchVerificationReport,
  createS07PagesProofReport,
  findPrivateReportLeakage,
  validateS07LaunchVerificationReport,
  validateS07PagesProofReport,
} from "../../scripts/record-s07-launch-verification.mjs";

test("S07 Pages proof accepts the GitHub Pages workflow contract", () => {
  const proof = createS07PagesProofReport({
    now: new Date("2026-01-02T03:04:05.000Z"),
    workflowText: fixtureWorkflow(),
  });

  assert.equal(proof.status, "pass");
  assert.equal(proof.generatedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(validateS07PagesProofReport(proof), []);
  assert.equal(proof.checks.every((check: any) => check.status === "pass"), true);
});

test("S07 Pages proof rejects missing local-only route removal", () => {
  const proof = createS07PagesProofReport({ workflowText: fixtureWorkflow().replace("rm -rf out/debug out/review", "echo keep-local-routes") });

  assert.equal(proof.status, "fail");
  assert.match(validateS07PagesProofReport(proof).join("\n"), /localOnlyRemoval/);
});

test("S07 Pages proof rejects missing public site origin env", () => {
  const proof = createS07PagesProofReport({ workflowText: fixtureWorkflow().replace(/\n\s*NEXT_PUBLIC_SITE_ORIGIN:.+/, "") });

  assert.equal(proof.status, "fail");
  assert.match(validateS07PagesProofReport(proof).join("\n"), /siteOriginEnv/);
});

test("S07 Pages proof rejects missing nojekyll marker", () => {
  const proof = createS07PagesProofReport({ workflowText: fixtureWorkflow().replace("touch out/.nojekyll", "echo no marker") });

  assert.equal(proof.status, "fail");
  assert.match(validateS07PagesProofReport(proof).join("\n"), /nojekyll/);
});

test("S07 launch verification rejects failing export reports with gate context", () => {
  const report = createS07LaunchVerificationReport({
    now: new Date("2026-01-02T03:04:05.000Z"),
    staticSmoke: fixtureStaticSmoke(),
    launchExport: { ...fixtureLaunchExport(), status: "fail" },
    pagesProof: fixturePagesProof(),
  });

  assert.equal(report.status, "fail");
  assert.equal(report.gates.routeLinkLeakage.status, "fail");
  assert.match(validateS07LaunchVerificationReport(report).join("\n"), /gate routeLinkLeakage must pass/);
});

test("S07 launch verification rejects failing smoke reports with gate context", () => {
  const report = createS07LaunchVerificationReport({
    staticSmoke: { ...fixtureStaticSmoke(), status: "fail" },
    launchExport: fixtureLaunchExport(),
    pagesProof: fixturePagesProof(),
  });

  assert.equal(report.status, "fail");
  assert.equal(report.gates.staticSmoke.status, "fail");
  assert.match(validateS07LaunchVerificationReport(report).join("\n"), /gate staticSmoke must pass/);
});

test("S07 redaction validation rejects private paths and secret-like tokens in upstream reports", () => {
  const report = createS07LaunchVerificationReport({
    staticSmoke: fixtureStaticSmoke(),
    launchExport: {
      ...fixtureLaunchExport(),
      checkedRoutes: [{ ...fixtureLaunchExport().checkedRoutes[0], note: "token: abcdefghijklmnop" }],
    },
    pagesProof: fixturePagesProof(),
  });

  assert.equal(report.status, "fail");
  assert.equal(report.gates.redaction.status, "fail");
  assert.match(report.gates.redaction.errors.join("\n"), /secret-like token/);
  assert.match(validateS07LaunchVerificationReport(report).join("\n"), /gate redaction must pass/);
  assert.notDeepEqual(findPrivateReportLeakage({ note: "file:///tmp/private" }), []);
});

test("S07 launch verification defaults to latest while preserving S07-specific artifact paths", () => {
  assert.equal(LAUNCH_EXPORT_PATH, "data/launch/s07-launch-export.json");
  assert.equal(STATIC_SMOKE_PATH, "data/launch/s07-static-smoke.json");
  assert.equal(PAGES_PROOF_PATH, "data/launch/s07-pages-proof.json");
  assert.equal(S07_REPORT_PATH, "data/launch/s07-launch-verification.json");
  assert.equal(FINAL_REPORT_PATH, "data/launch/latest.json");
});

test("S07 verifier script wires the canonical final launch gate phases", () => {
  const script = readFileSync("scripts/verify-s07.sh", "utf8");

  assert.match(script, /set -euo pipefail/);
  assert.match(script, /GITHUB_PAGES=\"\$\{GITHUB_PAGES:-true\}\"/);
  assert.match(script, /NEXT_PUBLIC_SITE_ORIGIN=\"\$\{NEXT_PUBLIC_SITE_ORIGIN:-https:\/\/votes\.yayarea\.news\}\"/);
  assert.match(script, /pnpm validate-data/);
  assert.match(script, /pnpm ingest:sources -- --manifest data\/ingestion\/manifest\.json --out data\/ingested/);
  assert.match(script, /pnpm report:source-race-coverage/);
  assert.match(script, /node --import tsx --test tests\/data\/s07-\*\.test\.ts/);
  assert.match(script, /pnpm test:data/);
  assert.match(script, /pnpm typecheck/);
  assert.match(script, /pnpm build/);
  assert.match(script, /rm -rf out\/debug out\/review/);
  assert.match(script, /touch out\/\.nojekyll/);
  assert.match(script, /node scripts\/assert-s07-export\.mjs --json-out data\/launch\/s07-launch-export\.json/);
  assert.match(script, /node scripts\/smoke-s07-static-export\.mjs --json-out data\/launch\/s07-static-smoke\.json/);
  assert.match(script, /node scripts\/record-s07-launch-verification\.mjs/);
});

test("S07 launch verification accepts pass artifacts and summarizes route, source, count, workflow, and redaction evidence", () => {
  const report = createS07LaunchVerificationReport({
    now: new Date("2026-01-02T03:04:05.000Z"),
    staticSmoke: fixtureStaticSmoke(),
    launchExport: fixtureLaunchExport(),
    pagesProof: fixturePagesProof(),
  });

  assert.equal(report.status, "pass");
  assert.deepEqual(validateS07ExportReport(fixtureLaunchExport()), []);
  assert.deepEqual(validateS07StaticSmokeReport(fixtureStaticSmoke()), []);
  assert.deepEqual(validateS07LaunchVerificationReport(report), []);
  assert.equal(report.summaries.routes.exportRoutes, 5);
  assert.equal(report.summaries.routes.staticSmokeRoutes, 5);
  assert.equal(report.summaries.sources.expectedRegisteredSources, 24);
  assert.equal(report.summaries.sources.minSourcesPerRace, 24);
  assert.equal(report.summaries.counts.brokenLinks, 0);
  assert.equal(report.workflowChecks.length >= 10, true);
  assert.equal(report.redaction.status, "pass");
  assert.equal(JSON.stringify(report).includes("/home/"), false);
  assert.equal(JSON.stringify(report).includes(".gsd"), false);
});

function fixturePagesProof() {
  return createS07PagesProofReport({
    now: new Date("2026-01-02T03:04:05.000Z"),
    workflowText: fixtureWorkflow(),
  });
}

function fixtureWorkflow() {
  return `name: Deploy GitHub Pages
jobs:
  build:
    steps:
      - name: Enable Corepack
        run: corepack enable
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Validate public data
        run: pnpm validate-data
      - name: Build static site
        env:
          GITHUB_PAGES: "true"
          NEXT_PUBLIC_SITE_ORIGIN: https://example.github.io/votes
        run: pnpm build
      - name: Remove local-only routes
        run: |
          rm -rf out/debug out/review
          touch out/.nojekyll
      - uses: actions/upload-pages-artifact@v4
        with:
          path: out
`;
}

function fixtureRoutes() {
  return [
    { route: "/", className: "homepage" },
    { route: "/races/california-governor/", className: "race" },
    { route: "/sources/official-source/", className: "source" },
    { route: "/entities/candidate-one/", className: "entity" },
    { route: "/how-we-use-ai/", className: "disclosure" },
  ];
}

function fixtureLaunchExport() {
  return {
    schemaVersion: 1,
    slice: "S07",
    generatedBy: "scripts/assert-s07-export.mjs",
    generatedAt: "2026-01-02T03:04:05.000Z",
    status: "pass",
    origin: "https://votes.yayarea.news",
    counts: {
      htmlFiles: 5,
      routes: 5,
      routeClasses: { homepage: 1, race: 1, source: 1, entity: 1, disclosure: 1 },
      linksChecked: 8,
      brokenLinks: 0,
      leakFindings: 0,
      localOnlyRouteArtifacts: 0,
      coverageRaceContracts: 1,
    },
    checkedRoutes: fixtureRoutes().map((route) => ({
      route: route.route,
      className: route.className,
      exportPath: route.route === "/" ? "out/index.html" : `out${route.route}index.html`,
      status: "pass",
      htmlBytes: 100,
      hasTitle: true,
      hasCanonical: true,
      missingText: [],
      missingPatterns: [],
    })),
    coverageContracts: [{ raceSlug: "california-governor", rowCount: 24, reviewedRowCount: 3, unresolvedRowCount: 21 }],
  };
}

function fixtureStaticSmoke() {
  return {
    schemaVersion: 1,
    slice: "S07",
    generatedBy: "scripts/smoke-s07-static-export.mjs",
    status: "pass",
    startedAt: "2026-01-02T03:04:05.000Z",
    completedAt: "2026-01-02T03:04:06.000Z",
    origin: "http://127.0.0.1:4321",
    counts: { checkedRoutes: 5, redirectChecks: 4, assetChecks: 1, routeClasses: { homepage: 1, race: 1, source: 1, entity: 1, disclosure: 1 } },
    checkedRoutes: fixtureRoutes().map((route) => ({ route: route.route, className: route.className, status: 200, contentType: "text/html; charset=utf-8", bytes: 100 })),
    redirectChecks: [
      { route: "/races/california-governor", status: 308, location: "/races/california-governor/", expectedLocation: "/races/california-governor/" },
      { route: "/sources/official-source", status: 308, location: "/sources/official-source/", expectedLocation: "/sources/official-source/" },
      { route: "/entities/candidate-one", status: 308, location: "/entities/candidate-one/", expectedLocation: "/entities/candidate-one/" },
      { route: "/how-we-use-ai", status: 308, location: "/how-we-use-ai/", expectedLocation: "/how-we-use-ai/" },
    ],
    assetChecks: [{ asset: "/_next/static/app.js", status: 200, contentType: "text/javascript; charset=utf-8", expectedType: "text/javascript", bytes: 10 }],
    phases: {
      preflight: { status: "pass" },
      routeDiscovery: { status: "pass" },
      serverStart: { status: "pass" },
      routeFetch: { status: "pass" },
      redirectChecks: { status: "pass" },
      assetChecks: { status: "pass" },
      smokeReport: { status: "pass" },
    },
  };
}
