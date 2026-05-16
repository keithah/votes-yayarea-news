import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-ignore JS launch-gate helpers are exercised through node --import tsx tests.
import { EXPECTED_REGISTERED_SOURCE_COUNT } from "../../scripts/assert-s07-export.mjs";
// @ts-ignore JS launch-gate helpers are exercised through node --import tsx tests.
import {
  createStaticServer,
  extractLocalAssetHrefs,
  runS07StaticSmoke,
  selectAssetSample,
  selectRoutesForSmoke,
  validateJsonOutPath,
  validateS07StaticSmokeReport,
} from "../../scripts/smoke-s07-static-export.mjs";

test("S07 static server rejects path traversal before touching files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s07-server-traversal-"));
  await writeText(path.join(tempDir, "out", "index.html"), "<!doctype html><html><body>ok</body></html>");
  const { server, origin } = await listen(createStaticServer({ outDir: path.join(tempDir, "out") }));

  try {
    const response = await fetch(`${origin}/%2e%2e%2fpackage.json`, { redirect: "manual" });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Bad request/);
  } finally {
    await close(server);
  }
});

test("S07 static server redirects extensionless exported routes to slash routes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s07-server-redirect-"));
  await writeText(path.join(tempDir, "out", "races", "california-governor", "index.html"), "<!doctype html><html><body>race</body></html>");
  const { server, origin } = await listen(createStaticServer({ outDir: path.join(tempDir, "out") }));

  try {
    const response = await fetch(`${origin}/races/california-governor`, { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "/races/california-governor/");
  } finally {
    await close(server);
  }
});

test("S07 static server strips the GitHub Pages base path when serving exported assets", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s07-server-basepath-"));
  await writeText(path.join(tempDir, "out", "_next", "static", "app.js"), "console.log('ok');");
  const { server, origin } = await listen(createStaticServer({ outDir: path.join(tempDir, "out"), basePath: "/votes-yayarea-news" }));

  try {
    const response = await fetch(`${origin}/votes-yayarea-news/_next/static/app.js`, { redirect: "manual" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/javascript/);
  } finally {
    await close(server);
  }
});

test("S07 static smoke uses exhaustive route contracts by default and supports bounded representatives", () => {
  const routes = [
    { route: "/", className: "homepage" },
    { route: "/races/a/", className: "race" },
    { route: "/races/b/", className: "race" },
    { route: "/sources/a/", className: "source" },
    { route: "/entities/a/", className: "entity" },
    { route: "/how-we-use-ai/", className: "disclosure" },
  ];

  assert.deepEqual(selectRoutesForSmoke(routes).map((route: { route: string }) => route.route), routes.map((route) => route.route));
  assert.deepEqual(selectRoutesForSmoke(routes, { exhaustive: false, sampleLimit: 4 }).map((route: { className: string }) => route.className), ["homepage", "race", "source", "entity"]);
});

test("S07 asset extraction keeps only same-origin static assets and expands srcset", () => {
  const html = `
    <link rel="stylesheet" href="/_next/static/app.css">
    <script src="/bundle.js"></script>
    <img src="https://example.org/offsite.png">
    <img srcset="/a.webp 1x, /b.png 2x">
    <a href="/races/california-governor/">not an asset</a>
    <img src="data:image/png;base64,abcd">
  `;

  assert.deepEqual(extractLocalAssetHrefs(html, "/", "http://127.0.0.1:4444"), ["/_next/static/app.css", "/a.webp", "/b.png", "/bundle.js"]);
});

test("S07 asset sampling is bounded and de-duplicates across route checks", () => {
  assert.deepEqual(
    selectAssetSample(
      [
        { route: "/", assets: ["/a.css", "/b.js"] },
        { route: "/races/a/", assets: ["/a.css", "/c.png"] },
      ],
      2,
    ),
    [
      { asset: "/a.css", sourceRoute: "/" },
      { asset: "/b.js", sourceRoute: "/" },
    ],
  );
});

test("S07 json-out validation rejects absolute, escaping, and non-launch paths", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s07-json-out-"));

  assert.throws(() => validateJsonOutPath("/tmp/s07.json", projectRoot), /project-relative path under data\/launch/);
  assert.throws(() => validateJsonOutPath("data/launch/../s07.json", projectRoot), /escapes data\/launch/);
  assert.throws(() => validateJsonOutPath("data/private/s07.json", projectRoot), /under data\/launch/);
  assert.throws(() => validateJsonOutPath("data/launch/s07.txt", projectRoot), /\.json file under data\/launch/);
  assert.equal(validateJsonOutPath("data/launch/s07-static-smoke.json", projectRoot), path.join(projectRoot, "data", "launch", "s07-static-smoke.json"));
});

test("S07 static smoke report validation rejects malformed reports and redaction leaks", () => {
  const errors = validateS07StaticSmokeReport({
    schemaVersion: 1,
    slice: "S07",
    generatedBy: "scripts/smoke-s07-static-export.mjs",
    status: "pass",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    origin: "http://127.0.0.1:3000",
    counts: { checkedRoutes: 1, redirectChecks: 0, assetChecks: 0, routeClasses: { homepage: 1 } },
    checkedRoutes: [{ route: "/", status: 200, contentType: "text/html", bytes: 10, exportPath: "/home/keith/out/index.html" }],
    redirectChecks: [],
    assetChecks: [],
  });

  assert.match(errors.join("\n"), /absolute local path/);
});

test("S07 static smoke reports route-qualified 404 failures", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  await writeCompleteStaticExport(outDir);
  await fs.rm(path.join(outDir, "sources"), { recursive: true, force: true });

  await assert.rejects(
    () => runS07StaticSmoke({ projectRoot, outDir }),
    (error: any) => {
      assert.equal(error.phase, "route-fetch");
      assert.match(error.message, /\/sources\/official-source\/ returned 404/);
      assert.equal(error.diagnostics?.checkedRoutes.some((route: { route: string; status: number }) => route.route === "/sources/official-source/" && route.status === 404), true);
      return true;
    },
  );
});

test("S07 static smoke rejects asset status and content-type failures with route and href context", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  await writeCompleteStaticExport(outDir, { homeHead: `<link rel="stylesheet" href="/assets/site.css">` });
  await writeText(path.join(outDir, "assets", "site.css", "index.html"), "<!doctype html><html><body>not css</body></html>");

  await assert.rejects(
    () => runS07StaticSmoke({ projectRoot, outDir }),
    (error: any) => {
      assert.equal(error.phase, "asset-content-type");
      assert.match(error.message, /\/assets\/site\.css returned text\/html/);
      assert.equal(error.diagnostics?.assetChecks[0].sourceRoute, "/");
      assert.equal(error.diagnostics?.assetChecks[0].asset, "/assets/site.css");
      return true;
    },
  );
});

test("S07 static smoke writes a redaction-safe exhaustive launch report", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  const reportPath = path.join(projectRoot, "data", "launch", "s07-static-smoke.json");
  await writeCompleteStaticExport(outDir, {
    homeHead: `<link rel="stylesheet" href="/assets/site.css"><script src="/assets/site.js"></script>`,
    homeBody: `<img src="/assets/logo.svg" alt="logo">`,
  });
  await writeText(path.join(outDir, "assets", "site.css"), "body{}");
  await writeText(path.join(outDir, "assets", "site.js"), "console.log('ok');");
  await writeText(path.join(outDir, "assets", "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"></svg>`);

  const report = await runS07StaticSmoke({ projectRoot, outDir, jsonOut: reportPath });
  const persisted = JSON.parse(await fs.readFile(reportPath, "utf8"));

  assert.equal(report.status, "pass");
  assert.equal(persisted.slice, "S07");
  assert.equal(persisted.counts.checkedRoutes, 5);
  assert.deepEqual(persisted.counts.routeClasses, { homepage: 1, race: 1, source: 1, entity: 1, disclosure: 1 });
  assert.equal(persisted.counts.redirectChecks, 4);
  assert.equal(persisted.counts.assetChecks, 3);
  assert.equal(persisted.checkedRoutes.every((route: { status: number; route: string }) => route.status === 200 && route.route.startsWith("/")), true);
  assert.equal(JSON.stringify(persisted).includes("/home/"), false);
  assert.equal(JSON.stringify(persisted).includes(".gsd"), false);
});

async function listen(server: any): Promise<{ server: any; origin: string }> {
  const address = await new Promise<any>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen(server.address()));
  });
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function close(server: any): Promise<void> {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function writeFixtureProject(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s07-smoke-project-"));
  const data = fixturePublicData();
  await fs.mkdir(path.join(projectRoot, "data", "public", "races"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "data", "public", "ballot-universe.json"), JSON.stringify(data.ballotUniverse, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "sources.json"), JSON.stringify(data.sources, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "entities.json"), JSON.stringify(data.entities, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "source-race-coverage.json"), JSON.stringify(data.sourceRaceCoverage, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "races", "california-governor.json"), JSON.stringify(data.raceRecords[0], null, 2));
  return projectRoot;
}

async function writeCompleteStaticExport(outDir: string, extras: { homeHead?: string; homeBody?: string } = {}): Promise<void> {
  await writeHtml(outDir, "/", html("votes.yayarea.news · San Francisco election guide", "/", `votes.yayarea.news Public races ${extras.homeBody ?? ""}<a href="/races/california-governor/">California Governor</a> <a href="/how-we-use-ai/">How we use AI</a>`, extras.homeHead));
  await writeHtml(outDir, "/races/california-governor/", html("California Governor source records", "/races/california-governor/", `California Governor Source-by-candidate comparison public sources No public position <main data-race-slug="california-governor" data-matrix-source-count="1" data-receipt-status="available"><a href="/sources/official-source/">Official Source</a><a href="/entities/candidate-one/">Candidate One</a></main>`));
  await writeHtml(outDir, "/sources/official-source/", html("Official Source public source trail", "/sources/official-source/", `Official Source Published recommendation trail <main data-drilldown-kind="source" data-recommendation-count="1"><a href="/races/california-governor/">California Governor</a></main>`));
  await writeHtml(outDir, "/entities/candidate-one/", html("Candidate One public source trail", "/entities/candidate-one/", `Candidate One Published recommendation trail <main data-drilldown-kind="entity" data-recommendation-count="1"><a href="/races/california-governor/">California Governor</a></main>`));
  await writeHtml(outDir, "/how-we-use-ai/", html("How we use AI", "/how-we-use-ai/", `How we use AI What AI helps with What humans review <main data-disclosure-route="how-we-use-ai"><a href="/">Home</a></main>`));
}

async function writeHtml(outDir: string, route: string, content: string): Promise<void> {
  const normalized = route === "/" ? "" : route.replace(/^\//, "").replace(/\/$/, "");
  const filePath = normalized ? path.join(outDir, normalized, "index.html") : path.join(outDir, "index.html");
  await writeText(filePath, content);
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function html(title: string, route: string, body: string, extraHead = ""): string {
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="https://votes.yayarea.news${route}">${extraHead}</head><body>${body}</body></html>`;
}

function fixturePublicData(): any {
  const sources = Array.from({ length: EXPECTED_REGISTERED_SOURCE_COUNT }, (_, index) => ({
    id: index === 0 ? "src-official" : `src-fixture-${String(index).padStart(2, "0")}`,
    slug: index === 0 ? "official-source" : `fixture-source-${String(index).padStart(2, "0")}`,
    name: index === 0 ? "Official Source" : `Fixture Source ${index}`,
    sourceType: index === 0 ? "official certified candidate list" : "civic voter guide / recommendations",
    status: "active",
  }));
  const coverageRows = sources.map((source: { id: string; slug: string; name: string }, index: number) => ({
    raceId: "race-california-governor",
    raceSlug: "california-governor",
    raceTitle: "California Governor",
    sourceId: source.id,
    sourceSlug: source.slug,
    sourceName: source.name,
    status: index === 0 ? "reviewed-public-position" : "pending-capture",
    positionIds: index === 0 ? ["pos-1"] : [],
    publicPositionIds: index === 0 ? ["pos-1"] : [],
    reviewedPublicPositionIds: index === 0 ? ["pos-1"] : [],
    ledgerStatus: index === 0 ? "reviewed" : "pending",
    reason: index === 0 ? "Reviewed public candidate-list source." : "Pending public 2026 guide URL.",
    notes: index === 0 ? "Public official source row." : "Keep pending until public guide is available.",
  }));

  return {
    ballotUniverse: {
      trackedRaces: [{ raceId: "race-california-governor", slug: "california-governor", title: "California Governor", publicationStatus: "public" }],
    },
    sources: { sources },
    entities: { entities: [{ id: "ent-candidate-one", slug: "candidate-one", name: "Candidate One", kind: "candidate", status: "verified" }] },
    sourceRaceCoverage: {
      ok: true,
      counts: { registeredSourceCount: EXPECTED_REGISTERED_SOURCE_COUNT, raceCount: 1, totalMatrixRows: EXPECTED_REGISTERED_SOURCE_COUNT },
      byRace: [{ raceId: "race-california-governor", raceSlug: "california-governor", raceTitle: "California Governor", counts: { "reviewed-public-position": 1, "pending-capture": EXPECTED_REGISTERED_SOURCE_COUNT - 1 }, sources: coverageRows }],
    },
    raceRecords: [
      {
        race: {
          id: "race-california-governor",
          slug: "california-governor",
          title: "California Governor",
          publicationStatus: "public",
          positions: [{ id: "pos-1", raceId: "race-california-governor", sourceId: "src-official", entityId: "ent-candidate-one", publicationStatus: "public", status: "verified", kind: "informational", evidence: [] }],
        },
      },
    ],
  };
}
