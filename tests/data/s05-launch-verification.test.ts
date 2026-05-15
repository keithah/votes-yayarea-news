import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyHref,
  discoverRouteContractsFromData,
  findBrokenInternalLinks,
  findForbiddenLeakagesInHtml,
  runS05LaunchExportAssertions,
  validateS05LaunchReport,
} from "../../scripts/assert-s05-launch-export.mjs";

test("S05 route discovery derives homepage, race, source, entity, and disclosure routes from public data", () => {
  const contracts = discoverRouteContractsFromData(fixturePublicData());
  const routes = contracts.routes.map((contract) => contract.route).sort();

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
  const ids = findings.map((finding) => finding.id).sort();

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

  await writeHtml(outDir, "/", pageHtml("/", "votes.yayarea.news", [`<a href="/races/california-governor/">Race</a>`, `<a href="https://example.org/safe">Safe external</a>`]));
  await writeHtml(outDir, "/races/california-governor/", pageHtml("/races/california-governor/", "California Governor", [`<a href="/sources/official-source/">Source</a>`, `<a href="/entities/candidate-one/">Entity</a>`]));
  await writeHtml(outDir, "/sources/official-source/", pageHtml("/sources/official-source/", "Official Source Published position receipts", [`<a href="/races/california-governor/">Race</a>`]));
  await writeHtml(outDir, "/entities/candidate-one/", pageHtml("/entities/candidate-one/", "Candidate One Published position receipts", [`<a href="/sources/official-source/">Source</a>`]));
  await writeHtml(outDir, "/how-we-use-ai/", pageHtml("/how-we-use-ai/", "How we use AI", []));

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

async function writeHtml(outDir: string, route: string, html: string) {
  const filePath = route === "/" ? path.join(outDir, "index.html") : path.join(outDir, route.replace(/^\//, ""), "index.html");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, html);
}

function pageHtml(route: string, body: string, links: string[]) {
  const normalizedRoute = route.endsWith("/") ? route : `${route}/`;
  return `<!doctype html><html><head><title>${body}</title><link rel="canonical" href="https://votes.yayarea.news${normalizedRoute}"></head><body><main>${body}${links.join("")}</main></body></html>`;
}
