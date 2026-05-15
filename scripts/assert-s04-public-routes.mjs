#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const OUT_DIR = "out";
const BALLOT_UNIVERSE_PATH = "data/public/ballot-universe.json";

function fail(message) {
  console.error(`[assert-s04-public-routes] ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Unable to read ${filePath}: ${error.message}`);
  }
}

function htmlPathForRoute(routePath) {
  const normalized = routePath.replace(/^\//, "").replace(/\/$/, "");
  if (normalized === "") return path.join(OUT_DIR, "index.html");
  const candidates = [path.join(OUT_DIR, normalized, "index.html"), path.join(OUT_DIR, `${normalized}.html`)];
  return candidates.find((candidate) => existsSync(candidate));
}

function readRoute(routePath, label = routePath) {
  const filePath = htmlPathForRoute(routePath);
  if (!filePath) {
    fail(`Missing expected S04 ${label} static export output for ${routePath}. Run pnpm build before this assertion.`);
  }
  return { filePath, html: readFileSync(filePath, "utf8") };
}

function assertIncludes(route, text, description) {
  if (!route.html.includes(text)) {
    fail(`Expected ${route.filePath} to include ${description}: ${JSON.stringify(text)}`);
  }
}

function assertMatches(route, pattern, description) {
  if (!pattern.test(route.html)) {
    fail(`Expected ${route.filePath} to match ${description}: ${pattern}`);
  }
}

function assertExcludes(route, pattern, description) {
  if (pattern.test(route.html)) {
    fail(`Did not expect ${route.filePath} to include ${description}: ${pattern}`);
  }
}

function listHtmlFiles(dir = OUT_DIR) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir).sort();
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) files.push(...listHtmlFiles(filePath));
    else if (entry.endsWith(".html")) files.push(filePath);
  }
  return files;
}

function discoverRouteFiles(prefix) {
  const dir = path.join(OUT_DIR, prefix);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((slug) => ({ slug, filePath: path.join(dir, slug, "index.html") }))
    .filter((entry) => existsSync(entry.filePath));
}

function readDiscovered(entry) {
  return { filePath: entry.filePath, html: readFileSync(entry.filePath, "utf8") };
}

if (!existsSync(OUT_DIR)) {
  fail(`Missing static export directory ${OUT_DIR}/. Run pnpm build before this assertion.`);
}

const htmlFiles = listHtmlFiles();
if (htmlFiles.length === 0) {
  fail(`Missing static export HTML files under ${OUT_DIR}/. Run pnpm build before this assertion.`);
}

const ballotUniverse = readJson(BALLOT_UNIVERSE_PATH);
const trackedRaces = Array.isArray(ballotUniverse.trackedRaces) ? ballotUniverse.trackedRaces : [];
const publicRaceBySlug = new Map(trackedRaces.filter((race) => race.publicationStatus === "public").map((race) => [race.slug, race]));

const homepage = readRoute("/", "homepage");
const governor = readRoute("/races/california-governor/", "California Governor race");
const disclosure = readRoute("/how-we-use-ai/", "AI disclosure");

const sourceRoutes = discoverRouteFiles("sources");
const entityRoutes = discoverRouteFiles("entities");
const raceRoutes = discoverRouteFiles("races");
if (sourceRoutes.length === 0) fail("Expected at least one generated source route from public reviewed positions.");
if (entityRoutes.length === 0) fail("Expected at least one generated entity route from public reviewed positions.");
if (raceRoutes.length === 0) fail("Expected at least one generated public race route.");

const source = readDiscovered(sourceRoutes.find((entry) => entry.slug === "california-secretary-of-state") ?? sourceRoutes[0]);
const entity = readDiscovered(entityRoutes.find((entry) => entry.slug === "california-governor-akinyemi-agbede") ?? entityRoutes[0]);
const optionalSfOffice = raceRoutes.find((entry) => /(?:san-francisco|supervisor|district|board-of-supervisors|assessor|sheriff|treasurer|city-attorney|district-attorney)/i.test(entry.slug));
const optionalMeasure = raceRoutes.find((entry) => /(?:^|-)prop(?:osition)?-|measure/i.test(entry.slug));
const representativeRoutes = [homepage, governor, source, entity, disclosure];
if (optionalSfOffice) representativeRoutes.push(readDiscovered(optionalSfOffice));
if (optionalMeasure && optionalMeasure.filePath !== optionalSfOffice?.filePath) representativeRoutes.push(readDiscovered(optionalMeasure));

assertIncludes(homepage, "votes.yayarea.news", "site title");
assertMatches(homepage, /13 public races/, "public race count copy");
assertIncludes(homepage, "How we use AI", "AI disclosure link copy");

assertIncludes(governor, "California Governor", "official race title");
assertIncludes(governor, "California Secretary of State", "official source name");
assertIncludes(governor, "/sources/california-secretary-of-state/", "source drill-down link");
assertIncludes(governor, "/entities/california-governor-akinyemi-agbede/", "entity drill-down link");
assertMatches(governor, /Source-by-candidate comparison|data-matrix-|recommendation matrix/i, "matrix markers");
assertMatches(governor, /evidence receipts|data-receipt-|Published position receipts/i, "receipt markers");
assertIncludes(governor, "Informational", "neutral informational position copy");

assertIncludes(source, "California Secretary of State", "source route public title");
assertIncludes(source, "Published position receipts", "source route receipt copy");
assertIncludes(source, "/races/california-governor/", "source route related race link");
assertMatches(source, /data-drilldown-(?:slug|evidence-id|evidence-status)/, "source route drill-down diagnostics");

assertIncludes(entity, "Akinyemi Agbede", "entity route public title");
assertIncludes(entity, "Published position receipts", "entity route receipt copy");
assertIncludes(entity, "/races/california-governor/", "entity route related race link");
assertIncludes(entity, "/sources/california-secretary-of-state/", "entity route related source link");
assertMatches(entity, /data-drilldown-(?:slug|evidence-id|evidence-status)/, "entity route drill-down diagnostics");

assertIncludes(disclosure, "How we use AI", "AI disclosure heading");
assertIncludes(disclosure, "AI does not decide how anyone should vote", "AI boundary disclosure copy");
assertIncludes(disclosure, "Public status controls what appears", "publication gate disclosure copy");
assertIncludes(disclosure, "data-disclosure-route=\"how-we-use-ai\"", "disclosure diagnostic route marker");

for (const entry of [optionalSfOffice, optionalMeasure].filter(Boolean)) {
  const route = readDiscovered(entry);
  const officialRace = publicRaceBySlug.get(entry.slug);
  if (officialRace?.title) {
    assertIncludes(route, officialRace.title, `official title for optional public route ${entry.slug}`);
  }
}

const forbiddenPatterns = [
  [/Sample Candidate/i, "sample candidate leakage"],
  [/sample-voter-guide/i, "sample voter-guide URL leakage"],
  [/(?:^|[\s/"'])mayor(?:[\s/"']|$)/i, "stale Mayor fixture leakage"],
  [/\/debug\//i, "debug route link leakage"],
  [/Visible diagnostics/i, "public diagnostic heading"],
  [/Checked public data files/i, "checked-file disclosure heading"],
  [/manual\/(?:reviews|overrides)\//i, "private manual review path"],
  [/data\/(?:public|extracted|ingested)\//i, "private data path"],
  [/\.gsd\//i, "private GSD path"],
  [/\/home\//i, "absolute local path"],
  [/file:\/\//i, "file URL path"],
  [/\b(?:vote\s+for|must\s+support|we\s+recommend|our\s+pick|best\s+choice)\b/i, "directive voting phrase"],
];

for (const route of representativeRoutes) {
  for (const [pattern, description] of forbiddenPatterns) assertExcludes(route, pattern, description);
}

const globalLeakPatterns = forbiddenPatterns.slice(0, 6);
for (const filePath of htmlFiles) {
  const html = readFileSync(filePath, "utf8");
  for (const [pattern, description] of globalLeakPatterns) {
    if (pattern.test(html)) fail(`Did not expect ${filePath} to include ${description}: ${pattern}`);
  }
}

console.log(
  `S04 public route export assertions passed: checked homepage, California Governor, ${source.filePath}, ${entity.filePath}, AI disclosure${optionalSfOffice ? `, ${optionalSfOffice.slug}` : ""}${optionalMeasure ? `, ${optionalMeasure.slug}` : ""}, and ${htmlFiles.length} HTML files for sample/debug leakage.`,
);
