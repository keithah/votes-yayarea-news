import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
// @ts-ignore JS launch-gate helpers are exercised through node --import tsx tests.
import {
  EXPECTED_REGISTERED_SOURCE_COUNT,
  assertRouteHtmlContracts,
  classifyHref,
  discoverS07RouteContractsFromData,
  findBrokenInternalLinks,
  findForbiddenLeakagesInHtml,
  findLocalOnlyRouteArtifacts,
  runS07ExportAssertions,
  validateRouteContract,
  validateS07ExportReport,
} from "../../scripts/assert-s07-export.mjs";

test("S07 route discovery derives homepage, all public races, source/entity drilldowns, disclosure, and 24-source coverage contracts", () => {
  const contracts = discoverS07RouteContractsFromData(fixturePublicData());
  const routes = contracts.routes.map((contract: { route: string }) => contract.route).sort();

  assert.deepEqual(contracts.issues, []);
  assert.equal(contracts.classCounts.homepage, 1);
  assert.equal(contracts.classCounts.disclosure, 1);
  assert.equal(contracts.classCounts.race, 1);
  assert.equal(contracts.classCounts.source, 1);
  assert.equal(contracts.classCounts.entity, 1);
  assert.deepEqual(contracts.coverageContracts, [{ raceSlug: "california-governor", rowCount: 24, reviewedRowCount: 1, unresolvedRowCount: 23 }]);
  assert.deepEqual(routes, [
    "/",
    "/entities/candidate-one/",
    "/how-we-use-ai/",
    "/races/california-governor/",
    "/sources/official-source/",
  ]);
});

test("S07 route discovery fails closed when race coverage does not include exactly 24 registered sources", () => {
  const data = fixturePublicData();
  data.sourceRaceCoverage.byRace[0].sources = data.sourceRaceCoverage.byRace[0].sources.slice(0, 23);

  const contracts = discoverS07RouteContractsFromData(data);

  assert.match(contracts.issues.join("\n"), /coverage california-governor: expected 24 source rows, found 23/);
  assert.match(contracts.issues.join("\n"), /coverage california-governor: missing registered sources src-fixture-23/);
});

test("S07 route discovery fails closed when unresolved coverage rows lack honest status labels", () => {
  const data = fixturePublicData();
  data.sourceRaceCoverage.byRace[0].sources[1] = { ...data.sourceRaceCoverage.byRace[0].sources[1], reason: "", notes: "", ledgerStatus: "" };

  const contracts = discoverS07RouteContractsFromData(data);

  assert.match(contracts.issues.join("\n"), /unresolved source rows need honest reason\/status labels src-fixture-01/);
});

test("S07 route contract validation rejects malformed route contracts", () => {
  assert.deepEqual(validateRouteContract({ route: "races/no-slash", className: "race", label: "Race", requiredText: [], requiredPatterns: [] }), [
    "route must be normalized with leading and trailing slash",
  ]);
  assert.match(validateRouteContract({ route: "/x/", className: "debug", requiredText: "x" }).join("\n"), /className must be/);
  assert.match(validateRouteContract(null).join("\n"), /route contract must be an object/);
});

test("S07 route HTML contracts report missing exports and missing required markers with route-qualified messages", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s07-route-contracts-"));
  const outDir = path.join(tempDir, "out");
  await writeHtml(outDir, "/", html("Home", "/", "votes.yayarea.news Public races"));

  const result = assertRouteHtmlContracts(
    [
      { route: "/", className: "homepage", label: "homepage", requiredText: ["Missing marker"], requiredPatterns: [/data-home-ready/] },
      { route: "/races/california-governor/", className: "race", label: "California Governor", requiredText: [], requiredPatterns: [] },
    ],
    outDir,
  );

  assert.match(result.failures.join("\n"), /\/ \([^)]*\) is missing route content "Missing marker"/);
  assert.match(result.failures.join("\n"), /\/ \([^)]*\) is missing required marker \/data-home-ready\//);
  assert.match(result.failures.join("\n"), /missing race route \/races\/california-governor\//);
});

test("S07 internal-link crawler reports source HTML, href, and missing target for broken internal links", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s07-links-"));
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
  assert.equal(classifyHref("https://votes.yayarea.news/how-we-use-ai", "/").route, "/how-we-use-ai/");
});

test("S07 forbidden leakage checks catch private paths, debug/review routes, and stale sample mayor copy", () => {
  const findings = findForbiddenLeakagesInHtml({
    "out/index.html": `Sample Candidate <a href="/debug/races/mayor/">debug</a> <a href="/review/positions/">review</a> file:///home/example/.gsd/x data-checked-file-count="2" sample-voter-guide`,
  });
  const ids = findings.map((finding: { id: string }) => finding.id).sort();

  assert.deepEqual(ids, [
    "absolute_local_path",
    "debug_route",
    "file_url",
    "private_diagnostics",
    "private_gsd_path",
    "private_manual_review_path",
    "review_route",
    "sample_candidate",
    "sample_voter_guide",
    "stale_mayor_fixture",
  ]);
});

test("S07 local-only route check rejects debug and review artifact directories", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "s07-local-routes-"));
  const outDir = path.join(tempDir, "out");
  await fs.mkdir(path.join(outDir, "debug"), { recursive: true });
  await fs.mkdir(path.join(outDir, "review"), { recursive: true });

  const artifacts = findLocalOnlyRouteArtifacts(outDir).map((filePath: string) => path.basename(filePath)).sort();

  assert.deepEqual(artifacts, ["debug", "review"]);
});

test("S07 export report validation rejects malformed artifacts and private path leakage", () => {
  const errors = validateS07ExportReport({
    schemaVersion: 1,
    slice: "S07",
    generatedBy: "scripts/assert-s07-export.mjs",
    generatedAt: "not-a-date",
    status: "pass",
    counts: { htmlFiles: 1, routes: 1, linksChecked: 0, brokenLinks: 0, leakFindings: 0, localOnlyRouteArtifacts: 0, coverageRaceContracts: 1 },
    checkedRoutes: [{ route: "/", exportPath: "/home/keith/out/index.html" }],
    coverageContracts: [{ raceSlug: "california-governor", rowCount: 24 }],
  });

  assert.match(errors.join("\n"), /generatedAt/);
  assert.match(errors.join("\n"), /absolute local path/);
});

test("S07 assertion runner fails fast with the exact missing public JSON path", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s07-missing-json-"));
  await fs.mkdir(path.join(projectRoot, "out"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "out", "index.html"), html("Home", "/", "votes.yayarea.news Public races"));

  assert.throws(
    () => runS07ExportAssertions({ projectRoot, outDir: path.join(projectRoot, "out") }),
    /route-discovery: missing required JSON data\/public\/ballot-universe\.json/,
  );
});

test("S07 assertion runner fails with parse context for malformed public JSON", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s07-malformed-json-"));
  await fs.mkdir(path.join(projectRoot, "out"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "out", "index.html"), html("Home", "/", "votes.yayarea.news Public races"));
  await fs.mkdir(path.join(projectRoot, "data", "public"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "data", "public", "ballot-universe.json"), "{ nope");

  assert.throws(
    () => runS07ExportAssertions({ projectRoot, outDir: path.join(projectRoot, "out") }),
    /route-discovery: malformed JSON data\/public\/ballot-universe\.json/,
  );
});

test("S07 assertion runner writes a redaction-safe launch report for minimal homepage, race, source, entity, and disclosure fixtures", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  const reportPath = path.join(projectRoot, "data", "launch", "s07-export-assertions.json");
  await writeCompleteStaticExport(outDir);

  const report = runS07ExportAssertions({ projectRoot, outDir, reportPath });
  const persisted = JSON.parse(await fs.readFile(reportPath, "utf8"));

  assert.equal(report.status, "pass");
  assert.equal(persisted.slice, "S07");
  assert.equal(persisted.counts.htmlFiles, 5);
  assert.equal(persisted.counts.routes, 5);
  assert.equal(persisted.counts.coverageRaceContracts, 1);
  assert.equal(persisted.counts.brokenLinks, 0);
  assert.equal(persisted.counts.leakFindings, 0);
  assert.equal(JSON.stringify(persisted).includes("/home/"), false);
  assert.equal(JSON.stringify(persisted).includes(".gsd"), false);
});

test("S07 assertion runner rejects debug route emission before writing a pass report", async () => {
  const projectRoot = await writeFixtureProject();
  const outDir = path.join(projectRoot, "out");
  await writeCompleteStaticExport(outDir);
  await fs.mkdir(path.join(outDir, "debug"), { recursive: true });

  assert.throws(
    () => runS07ExportAssertions({ projectRoot, outDir, reportPath: path.join(projectRoot, "data", "launch", "s07-export-assertions.json") }),
    /local-only-routes: final artifact must not include out\/debug/,
  );
});

async function writeFixtureProject(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "s07-project-"));
  const data = fixturePublicData();
  await fs.mkdir(path.join(projectRoot, "data", "public", "races"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "data", "public", "ballot-universe.json"), JSON.stringify(data.ballotUniverse, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "sources.json"), JSON.stringify(data.sources, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "entities.json"), JSON.stringify(data.entities, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "source-race-coverage.json"), JSON.stringify(data.sourceRaceCoverage, null, 2));
  await fs.writeFile(path.join(projectRoot, "data", "public", "races", "california-governor.json"), JSON.stringify(data.raceRecords[0], null, 2));
  return projectRoot;
}

async function writeCompleteStaticExport(outDir: string): Promise<void> {
  await writeHtml(outDir, "/", html("votes.yayarea.news · San Francisco election guide", "/", `votes.yayarea.news Public races <a href="/races/california-governor/">California Governor</a> <a href="/how-we-use-ai/">How we use AI</a>`));
  await writeHtml(outDir, "/races/california-governor/", html("California Governor source records", "/races/california-governor/", `California Governor Source-by-candidate comparison public sources No public position <main data-race-slug="california-governor" data-matrix-source-count="1" data-receipt-status="available"><a href="/sources/official-source/">Official Source</a><a href="/entities/candidate-one/">Candidate One</a></main>`));
  await writeHtml(outDir, "/sources/official-source/", html("Official Source public source trail", "/sources/official-source/", `Official Source Published recommendation trail <main data-drilldown-kind="source" data-recommendation-count="1"><a href="/races/california-governor/">California Governor</a></main>`));
  await writeHtml(outDir, "/entities/candidate-one/", html("Candidate One public source trail", "/entities/candidate-one/", `Candidate One Published recommendation trail <main data-drilldown-kind="entity" data-recommendation-count="1"><a href="/races/california-governor/">California Governor</a></main>`));
  await writeHtml(outDir, "/how-we-use-ai/", html("How we use AI", "/how-we-use-ai/", `How we use AI What AI helps with What humans review <main data-disclosure-route="how-we-use-ai"><a href="/">Home</a></main>`));
}

async function writeHtml(outDir: string, route: string, content: string): Promise<void> {
  const normalized = route === "/" ? "" : route.replace(/^\//, "").replace(/\/$/, "");
  const filePath = normalized ? path.join(outDir, normalized, "index.html") : path.join(outDir, "index.html");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function html(title: string, route: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="https://votes.yayarea.news${route}"></head><body>${body}</body></html>`;
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
      trackedRaces: [
        {
          raceId: "race-california-governor",
          slug: "california-governor",
          title: "California Governor",
          publicationStatus: "public",
        },
      ],
    },
    sources: { sources },
    entities: { entities: [{ id: "ent-candidate-one", slug: "candidate-one", name: "Candidate One", kind: "candidate", status: "verified" }] },
    sourceRaceCoverage: {
      ok: true,
      counts: { registeredSourceCount: EXPECTED_REGISTERED_SOURCE_COUNT, raceCount: 1, totalMatrixRows: EXPECTED_REGISTERED_SOURCE_COUNT },
      byRace: [
        {
          raceId: "race-california-governor",
          raceSlug: "california-governor",
          raceTitle: "California Governor",
          counts: { "reviewed-public-position": 1, "pending-capture": EXPECTED_REGISTERED_SOURCE_COUNT - 1 },
          sources: coverageRows,
        },
      ],
    },
    raceRecords: [
      {
        race: {
          id: "race-california-governor",
          slug: "california-governor",
          title: "California Governor",
          publicationStatus: "public",
          positions: [
            {
              id: "pos-1",
              raceId: "race-california-governor",
              sourceId: "src-official",
              entityId: "ent-candidate-one",
              publicationStatus: "public",
              status: "verified",
              kind: "informational",
              evidence: [],
            },
          ],
        },
      },
    ],
  };
}
