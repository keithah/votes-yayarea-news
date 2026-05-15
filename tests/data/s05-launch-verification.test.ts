import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-ignore JS launch-gate helpers are exercised through node --import tsx tests.
import {
  classifyHref,
  discoverRouteContractsFromData,
  findBrokenInternalLinks,
  findForbiddenLeakagesInHtml,
  runS05LaunchExportAssertions,
  validateS05LaunchReport,
} from "../../scripts/assert-s05-launch-export.mjs";
// @ts-ignore JS static-smoke helpers are exercised through node --import tsx tests.
import {
  choosePort,
  extractLocalAssetHrefs,
  runS05StaticSmoke,
  safeFilePath,
  validateJsonOutPath,
  validateS05StaticSmokeReport,
} from "../../scripts/smoke-s05-static-export.mjs";
// @ts-ignore JS launch-verification helpers are exercised through node --import tsx tests.
import {
  FINAL_REPORT_PATH,
  S05_REPORT_PATH,
  createS05LaunchVerificationReport,
  validateS05BrowserEvidence,
  validateS05LaunchVerificationReport,
} from "../../scripts/record-s05-launch-verification.mjs";

test("S05 route discovery derives homepage, race, source, entity, and disclosure routes from public data", () => {
  const contracts = discoverRouteContractsFromData(fixturePublicData());
  const routes = contracts.routes.map((contract: { route: string }) => contract.route).sort();

  assert.deepEqual(contracts.issues, []);
  assert.equal(contracts.classCounts.homepage, 1);
  assert.equal(contracts.classCounts.disclosure, 1);
  assert.equal(contracts.classCounts.race, 1);
  assert.equal(contracts.classCounts.source, 1);
  assert.equal(contracts.classCounts.entity, 1);
  assert.deepEqual(routes, [
    "/",
    "/entities/candidate-one/",
    "/how-we-use-ai/",
    "/races/california-governor/",
    "/sources/official-source/",
  ]);
});

test("S05 route discovery fails closed when required public route classes cannot be discovered", () => {
  const contracts = discoverRouteContractsFromData({
    ballotUniverse: { trackedRaces: [{ slug: "california-governor", title: "California Governor", publicationStatus: "public" }] },
    sources: { sources: [] },
    entities: { entities: [] },
    raceRecords: [{ race: { slug: "california-governor", publicationStatus: "public", positions: [{ publicationStatus: "public", sourceId: "missing-source", entityId: "missing-entity" }] } }],
  });

  assert.match(contracts.issues.join("\n"), /route class source: missing-source/);
  assert.match(contracts.issues.join("\n"), /route class entity: missing-entity/);
});

test("S05 internal-link classification treats same-origin links as export targets and ignores safe external links", () => {
  assert.deepEqual(classifyHref("/races/california-governor/", "/"), {
    kind: "internal",
    href: "/races/california-governor/",
    route: "/races/california-governor/",
  });
  assert.deepEqual(classifyHref("https://votes.yayarea.news/how-we-use-ai", "/"), {
    kind: "internal",
    href: "https://votes.yayarea.news/how-we-use-ai",
    route: "/how-we-use-ai/",
  });
  assert.equal(classifyHref("https://example.org/voter-guide", "/").kind, "external");
  assert.equal(classifyHref("mailto:test@example.org", "/").kind, "ignored");
  assert.equal(classifyHref("#main", "/").kind, "ignored");
});

test("S05 link crawler reports source HTML, href, and missing target for broken internal links", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s05-links-"));
  const outDir = path.join(tempDir, "out");
  await writeHtml(outDir, "/", `<a href="/races/california-governor/">Governor</a><a href="https://example.org/">External</a>`);

  const broken = findBrokenInternalLinks([path.join(outDir, "index.html")], outDir);

  assert.deepEqual(broken, [
    {
      sourceHtml: path.join(outDir, "index.html"),
      sourceRoute: "/",
      href: "/races/california-governor/",
      targetRoute: "/races/california-governor/",
    },
  ]);
});

test("S05 forbidden leakage checks catch private paths, stale fixtures, debug links, and directive endorsement copy", () => {
  const findings = findForbiddenLeakagesInHtml({
    "out/index.html": `Sample Candidate <a href="/debug/races/mayor/">debug</a> file:///home/example/.gsd/x We recommend Candidate A`,
    "out/how-we-use-ai/index.html": "AI does not decide how anyone should vote.",
  });
  const ids = findings.map((finding: { id: string }) => finding.id).sort();

  assert.deepEqual(ids, [
    "absolute_local_path",
    "debug_route",
    "directive_endorsement",
    "file_url",
    "private_gsd_path",
    "sample_candidate",
    "stale_mayor_fixture",
  ]);
});

test("S05 launch report validation rejects malformed artifacts and private path leakage", () => {
  const errors = validateS05LaunchReport({
    schemaVersion: 1,
    slice: "S05",
    generatedBy: "scripts/assert-s05-launch-export.mjs",
    generatedAt: "not-a-date",
    status: "pass",
    counts: { htmlFiles: 1, routes: 1, linksChecked: 0, brokenLinks: 0, leakFindings: 0 },
    checkedRoutes: [{ route: "/", exportPath: "/home/keith/out/index.html" }],
  });

  assert.match(errors.join("\n"), /generatedAt/);
  assert.match(errors.join("\n"), /absolute local path/);
});

test("S05 assertion runner fails cleanly when out directory is absent", async () => {
  const projectRoot = await writeFixtureProject();

  assert.throws(
    () => runS05LaunchExportAssertions({ projectRoot, outDir: path.join(projectRoot, "out") }),
    /preflight: Missing static export directory out\/. Run pnpm build before this assertion\./,
  );
});

test("S05 assertion runner writes a redaction-safe launch report for a complete static export", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  const reportPath = path.join(projectRoot, "data", "launch", "s05-launch-export.json");

  await writeCompleteStaticExport(outDir);

  const report = runS05LaunchExportAssertions({ projectRoot, outDir, reportPath });
  const persisted = JSON.parse(await fs.readFile(reportPath, "utf8"));

  assert.equal(report.status, "pass");
  assert.equal(persisted.slice, "S05");
  assert.equal(persisted.counts.htmlFiles, 5);
  assert.equal(persisted.counts.brokenLinks, 0);
  assert.equal(persisted.counts.leakFindings, 0);
  assert.equal(JSON.stringify(persisted).includes("/home/"), false);
  assert.equal(JSON.stringify(persisted).includes(".gsd"), false);
});

test("S05 static smoke rejects invalid ports, traversal paths, and malformed json-out targets", async () => {
  assert.throws(() => choosePort({ S05_SMOKE_PORT: "abc" }), /invalid S05_SMOKE_PORT/);
  assert.throws(() => choosePort({ S05_SMOKE_PORT: "80" }), /invalid S05_SMOKE_PORT/);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s05-smoke-paths-"));
  const outDir = path.join(tempDir, "out");
  await fs.mkdir(outDir, { recursive: true });

  assert.equal(safeFilePath("/../secret.txt", outDir), null);
  assert.equal(safeFilePath("/%2e%2e/secret.txt", outDir), null);
  assert.throws(() => validateJsonOutPath("../s05-static-smoke.json", tempDir), /data\/launch/);
  assert.throws(() => validateJsonOutPath("data/launch/../s05-static-smoke.json", tempDir), /escapes data\/launch/);
});

test("S05 static smoke report validation rejects malformed artifacts and private path leakage", () => {
  const errors = validateS05StaticSmokeReport({
    schemaVersion: 1,
    slice: "S05",
    generatedBy: "scripts/smoke-s05-static-export.mjs",
    status: "pass",
    startedAt: new Date().toISOString(),
    completedAt: "not-a-date",
    origin: "http://127.0.0.1:4321",
    counts: { checkedRoutes: 1, redirectChecks: 0, assetChecks: 0 },
    checkedRoutes: [{ route: "/", status: 200, contentType: "text/html", bytes: 10, note: "/home/keith/out/index.html" }],
    redirectChecks: [],
    assetChecks: [],
  });

  assert.match(errors.join("\n"), /completedAt/);
  assert.match(errors.join("\n"), /absolute local path/);
});

test("S05 static smoke extracts only same-origin local JS, CSS, and image assets", () => {
  const assets = extractLocalAssetHrefs(
    `<link rel="stylesheet" href="/_next/static/app.css"><script src="/_next/static/app.js"></script><img src="/icon.png"><img srcset="/small.webp 1x, https://cdn.example.org/large.webp 2x"><img src="data:image/png;base64,abc">`,
    "/",
    "http://127.0.0.1:4321",
  );

  assert.deepEqual(assets, ["/_next/static/app.css", "/_next/static/app.js", "/icon.png", "/small.webp"]);
});

test("S05 static smoke fails cleanly when out directory is absent", async () => {
  const projectRoot = await writeFixtureProject();

  await assert.rejects(
    () => runS05StaticSmoke({ projectRoot, outDir: path.join(projectRoot, "out"), port: 0 }),
    /preflight: missing out\/ directory\. Run pnpm build before S05 static smoke\./,
  );
});

test("S05 static smoke reports non-HTML route responses with phase diagnostics", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  await writeCompleteStaticExport(outDir);
  await fs.writeFile(path.join(outDir, "how-we-use-ai", "index.html"), JSON.stringify({ ok: true }));

  await assert.rejects(
    () => runS05StaticSmoke({ projectRoot, outDir, port: 0 }),
    (error: any) => {
      assert.equal(error.phase, "content-type");
      assert.match(error.message, /\/how-we-use-ai\/ returned text\/html headers but the body was not an HTML document/);
      assert.equal(error.diagnostics.checkedRoutes.some((route: any) => route.route === "/how-we-use-ai/" && route.status === 200), true);
      return true;
    },
  );
});

test("S05 static smoke writes a redaction-safe JSON report for the fixture export", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  const reportPath = validateJsonOutPath("data/launch/s05-static-smoke.json", projectRoot);

  await writeCompleteStaticExport(outDir);

  const report = await runS05StaticSmoke({ projectRoot, outDir, jsonOut: reportPath, port: 0 });
  const persisted = JSON.parse(await fs.readFile(reportPath, "utf8"));

  assert.equal(report.status, "pass");
  assert.equal(persisted.status, "pass");
  assert.equal(persisted.slice, "S05");
  assert.equal(persisted.counts.checkedRoutes, 5);
  assert.equal(persisted.counts.redirectChecks, 4);
  assert.equal(persisted.counts.assetChecks >= 3, true);
  assert.equal(persisted.checkedRoutes.every((route: any) => route.status === 200 && route.contentType.startsWith("text/html")), true);
  assert.equal(persisted.redirectChecks.every((redirect: any) => redirect.status === 308 && redirect.location === redirect.expectedLocation), true);
  assert.equal(persisted.assetChecks.every((asset: any) => asset.status !== 404 && asset.bytes > 0), true);
  assert.deepEqual(validateS05StaticSmokeReport(persisted), []);
  assert.equal(JSON.stringify(persisted).includes("/home/"), false);
  assert.equal(JSON.stringify(persisted).includes(".gsd"), false);
});

test("S05 browser evidence validation accepts desktop and mobile route coverage", () => {
  const evidence = fixtureBrowserEvidence();

  assert.deepEqual(validateS05BrowserEvidence(evidence), []);
});

test("S05 browser evidence validation rejects missing mobile evidence", () => {
  const evidence = fixtureBrowserEvidence({ devices: [fixtureDevice("desktop")] });

  assert.match(validateS05BrowserEvidence(evidence).join("\n"), /mobile entry/);
});

test("S05 browser evidence validation rejects console errors with device context", () => {
  const evidence = fixtureBrowserEvidence({ devices: [fixtureDevice("desktop", { consoleErrors: [{ text: "boom" }] }), fixtureDevice("mobile")] });

  assert.match(validateS05BrowserEvidence(evidence).join("\n"), /device desktop consoleErrors must be empty/);
});

test("S05 browser evidence validation rejects failed route assertions with route context", () => {
  const failedRoute = { ...fixtureRoute("/", "homepage"), assertions: [{ name: "main-visible", status: "fail" }] };
  const evidence = fixtureBrowserEvidence({ devices: [fixtureDevice("desktop", { routes: [failedRoute, ...fixtureRoutes().slice(1)] }), fixtureDevice("mobile")] });

  assert.match(validateS05BrowserEvidence(evidence).join("\n"), /device desktop route \/ assertion main-visible must pass/);
});

test("S05 browser evidence validation rejects malformed timestamps and private path leakage", () => {
  const evidence = fixtureBrowserEvidence({ checkedAt: "not-a-date", notes: "debug file:///home/keith/.gsd/private" });
  const errors = validateS05BrowserEvidence(evidence).join("\n");

  assert.match(errors, /checkedAt/);
  assert.match(errors, /file URL path/);
  assert.match(errors, /absolute local path/);
  assert.match(errors, /private GSD path/);
});

test("S05 launch verification report rejects stale S09 slice values", () => {
  const staticSmoke = fixtureStaticSmoke();
  const browserEvidence = fixtureBrowserEvidence();
  const launchExport = { ...fixtureLaunchExport(), slice: "S09" };
  const report = createS05LaunchVerificationReport({ now: new Date("2026-01-02T03:04:05.000Z"), staticSmoke, browserEvidence, launchExport });

  assert.equal(report.status, "fail");
  assert.match(validateS05LaunchVerificationReport(report).join("\n"), /gate routeLinkLeakage must pass/);
});

test("S05 launch verification defaults to latest launch gate while preserving the S05-specific artifact path", () => {
  assert.equal(FINAL_REPORT_PATH, "data/launch/latest.json");
  assert.equal(S05_REPORT_PATH, "data/launch/s05-launch-verification.json");
});

test("S05 launch verification report accepts pass artifacts and stays redaction-safe", () => {
  const report = createS05LaunchVerificationReport({
    now: new Date("2026-01-02T03:04:05.000Z"),
    staticSmoke: fixtureStaticSmoke(),
    browserEvidence: fixtureBrowserEvidence(),
    launchExport: fixtureLaunchExport(),
  });

  assert.equal(report.status, "pass");
  assert.equal(report.generatedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(validateS05LaunchVerificationReport(report), []);
  assert.equal(JSON.stringify(report).includes("/home/"), false);
  assert.equal(JSON.stringify(report).includes(".gsd"), false);
});

function fixtureRoute(route: string, className: string) {
  return {
    route,
    className,
    url: `http://127.0.0.1:4321${route}`,
    status: 200,
    title: className,
    assertions: [
      { name: "http-200", status: "pass" },
      { name: "main-visible", status: "pass" },
      { name: "no-private-leakage", status: "pass" },
    ],
  };
}

function fixtureRoutes() {
  return [
    fixtureRoute("/", "homepage"),
    fixtureRoute("/races/california-governor/", "race"),
    fixtureRoute("/sources/official-source/", "source"),
    fixtureRoute("/entities/candidate-one/", "entity"),
    fixtureRoute("/how-we-use-ai/", "disclosure"),
  ];
}

function fixtureDevice(kind: "desktop" | "mobile", overrides: Record<string, unknown> = {}) {
  return {
    name: kind,
    kind,
    viewport: kind === "desktop" ? { width: 1440, height: 1000, isMobile: false } : { width: 390, height: 844, isMobile: true },
    userAgent: `${kind} fixture browser`,
    consoleErrors: [],
    routes: fixtureRoutes(),
    ...overrides,
  };
}

function fixtureBrowserEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    slice: "S05",
    generatedBy: "browser-tools",
    checkedAt: "2026-01-02T03:04:05.000Z",
    origin: "http://127.0.0.1:4321",
    devices: [fixtureDevice("desktop"), fixtureDevice("mobile")],
    ...overrides,
  };
}

function fixtureStaticSmoke() {
  return {
    schemaVersion: 1,
    slice: "S05",
    generatedBy: "scripts/smoke-s05-static-export.mjs",
    status: "pass",
    startedAt: "2026-01-02T03:04:05.000Z",
    completedAt: "2026-01-02T03:04:06.000Z",
    origin: "http://127.0.0.1:4321",
    counts: { checkedRoutes: 5, redirectChecks: 4, assetChecks: 1 },
    checkedRoutes: fixtureRoutes().map((route) => ({ route: route.route, status: 200, contentType: "text/html; charset=utf-8", bytes: 100 })),
    redirectChecks: [
      { route: "/races/california-governor", status: 308, location: "/races/california-governor/", expectedLocation: "/races/california-governor/" },
      { route: "/sources/official-source", status: 308, location: "/sources/official-source/", expectedLocation: "/sources/official-source/" },
      { route: "/entities/candidate-one", status: 308, location: "/entities/candidate-one/", expectedLocation: "/entities/candidate-one/" },
      { route: "/how-we-use-ai", status: 308, location: "/how-we-use-ai/", expectedLocation: "/how-we-use-ai/" },
    ],
    assetChecks: [{ asset: "/_next/static/app.js", status: 200, contentType: "text/javascript; charset=utf-8", expectedType: "text/javascript", bytes: 10 }],
  };
}

function fixtureLaunchExport() {
  return {
    schemaVersion: 1,
    slice: "S05",
    generatedBy: "scripts/assert-s05-launch-export.mjs",
    generatedAt: "2026-01-02T03:04:05.000Z",
    status: "pass",
    origin: "https://votes.yayarea.news",
    counts: { htmlFiles: 5, routes: 5, linksChecked: 8, brokenLinks: 0, leakFindings: 0 },
    checkedRoutes: fixtureRoutes().map((route) => ({ route: route.route, className: route.className, exportPath: route.route === "/" ? "out/index.html" : `out${route.route}index.html`, status: "pass", htmlBytes: 100, hasTitle: true, hasCanonical: true, missingText: [] })),
  };
}

function fixturePublicData() {
  return {
    ballotUniverse: {
      trackedRaces: [
        { slug: "california-governor", title: "California Governor", publicationStatus: "public" },
        { slug: "hidden-race", title: "Hidden Race", publicationStatus: "hidden" },
      ],
    },
    sources: { sources: [{ id: "src-official", slug: "official-source", name: "Official Source" }] },
    entities: { entities: [{ id: "ent-candidate", slug: "candidate-one", name: "Candidate One" }] },
    raceRecords: [
      {
        race: {
          slug: "california-governor",
          publicationStatus: "public",
          positions: [{ publicationStatus: "public", sourceId: "src-official", entityId: "ent-candidate" }],
        },
      },
    ],
  };
}

async function writeFixtureProject() {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s05-project-"));
  const data = fixturePublicData();
  await fs.mkdir(path.join(projectRoot, "data", "public", "races"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "data", "public", "ballot-universe.json"), `${JSON.stringify(data.ballotUniverse, null, 2)}\n`);
  await fs.writeFile(path.join(projectRoot, "data", "public", "sources.json"), `${JSON.stringify(data.sources, null, 2)}\n`);
  await fs.writeFile(path.join(projectRoot, "data", "public", "entities.json"), `${JSON.stringify(data.entities, null, 2)}\n`);
  await fs.writeFile(path.join(projectRoot, "data", "public", "races", "california-governor.json"), `${JSON.stringify(data.raceRecords[0], null, 2)}\n`);
  return projectRoot;
}

async function writeCompleteStaticExport(outDir: string) {
  await writeHtml(
    outDir,
    "/",
    pageHtml("/", "votes.yayarea.news", [
      `<link rel="stylesheet" href="/_next/static/app.css">`,
      `<script src="/_next/static/app.js"></script>`,
      `<img src="/icon.png" alt="">`,
      `<a href="/races/california-governor/">Race</a>`,
      `<a href="https://example.org/safe">Safe external</a>`,
    ]),
  );
  await writeHtml(outDir, "/races/california-governor/", pageHtml("/races/california-governor/", "California Governor", [`<a href="/sources/official-source/">Source</a>`, `<a href="/entities/candidate-one/">Entity</a>`]));
  await writeHtml(outDir, "/sources/official-source/", pageHtml("/sources/official-source/", "Official Source Published position receipts", [`<a href="/races/california-governor/">Race</a>`]));
  await writeHtml(outDir, "/entities/candidate-one/", pageHtml("/entities/candidate-one/", "Candidate One Published position receipts", [`<a href="/sources/official-source/">Source</a>`]));
  await writeHtml(outDir, "/how-we-use-ai/", pageHtml("/how-we-use-ai/", "How we use AI", []));
  await fs.mkdir(path.join(outDir, "_next", "static"), { recursive: true });
  await fs.writeFile(path.join(outDir, "_next", "static", "app.css"), "body{color:#111}\n");
  await fs.writeFile(path.join(outDir, "_next", "static", "app.js"), "console.log('fixture')\n");
  await fs.writeFile(path.join(outDir, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

async function writeHtml(outDir: string, route: string, html: string) {
  const filePath = route === "/" ? path.join(outDir, "index.html") : path.join(outDir, route.replace(/^\//, ""), "index.html");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, html);
}

function pageHtml(route: string, body: string, links: string[]) {
  const normalizedRoute = route.endsWith("/") ? route : `${route}/`;
  return `<!doctype html><html><head><title>${body}</title><link rel="canonical" href="https://votes.yayarea.news${normalizedRoute}"></head><body><main>${body}${links.join("")}</main></body></html>`;
}
