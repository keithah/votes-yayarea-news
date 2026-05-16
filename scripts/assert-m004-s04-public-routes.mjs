#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const OUT_DIR = "out";

function fail(message) {
  console.error(`[assert-m004-s04-public-routes] ${message}`);
  process.exit(1);
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
    fail(`Missing expected M004/S04 ${label} static export output for ${routePath}. Run pnpm build before this assertion.`);
  }
  return { routePath, filePath, html: readFileSync(filePath, "utf8") };
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

function assertExcludes(filePath, html, pattern, description) {
  if (pattern.test(html)) {
    fail(`Did not expect ${filePath} to include ${description}: ${pattern}`);
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

function assertCommonRaceSurface(route, slug, title) {
  assertIncludes(route, title, "race title");
  assertIncludes(route, `data-race-slug=\"${slug}\"`, "stable race slug marker");
  assertIncludes(route, "Source-by-candidate comparison", "recommendation matrix heading");
  assertMatches(route, /data-matrix-source-count=\"[2-9][0-9]*\"/, "multi-source matrix source count");
  assertMatches(route, /data-matrix-cell-count=\"[1-9][0-9]*\"/, "non-empty matrix cell count");
  assertIncludes(route, "data-matrix-view=\"desktop\"", "desktop matrix marker");
  assertIncludes(route, "data-matrix-view=\"mobile\"", "mobile matrix marker");
  assertMatches(route, /data-receipt-(?:count|available-count|status)=\"[^"]+\"/, "receipt diagnostics marker");
}

if (!existsSync(OUT_DIR)) {
  fail(`Missing static export directory ${OUT_DIR}/. Run pnpm build before this assertion.`);
}

const htmlFiles = listHtmlFiles();
if (htmlFiles.length === 0) {
  fail(`Missing static export HTML files under ${OUT_DIR}/. Run pnpm build before this assertion.`);
}

const stateAssembly = readRoute("/races/state-assembly-district-17/", "State Assembly District 17 race");
const governor = readRoute("/races/california-governor/", "California Governor race");
const usHouse = readRoute("/races/us-house-district-11/", "U.S. House District 11 race");
const representativeRoutes = [stateAssembly, governor, usHouse];

assertCommonRaceSurface(stateAssembly, "state-assembly-district-17", "State Assembly District 17");
assertIncludes(stateAssembly, "California Secretary of State", "Secretary of State source label");
assertIncludes(stateAssembly, "GrowSF", "GrowSF source label");
assertIncludes(stateAssembly, "data-source-id=\"src-ca-secretary-of-state\"", "Secretary of State source marker");
assertIncludes(stateAssembly, "data-source-id=\"src-growsf\"", "GrowSF source marker");
assertIncludes(stateAssembly, "data-candidate-id=\"ent-state-assembly-district-17-matt-haney\"", "Matt Haney candidate marker");
assertIncludes(stateAssembly, "data-position-kind=\"informational\"", "Secretary of State informational matrix cell");
assertIncludes(stateAssembly, "data-position-kind=\"endorse\"", "GrowSF endorsement matrix cell");
assertIncludes(stateAssembly, "data-receipt-status=\"available\"", "available receipt marker");

assertCommonRaceSurface(governor, "california-governor", "California Governor");
assertIncludes(governor, "California Secretary of State", "Secretary of State source label");
assertIncludes(governor, "San Francisco Chronicle", "San Francisco Chronicle source label");
assertIncludes(governor, "data-source-id=\"src-ca-secretary-of-state\"", "Secretary of State source marker");
assertIncludes(governor, "data-source-id=\"src-sf-chronicle\"", "Chronicle source marker");
assertIncludes(governor, "data-candidate-id=\"ent-california-governor-katie-porter\"", "Katie Porter candidate marker");
assertIncludes(governor, "data-position-kind=\"endorse\"", "Chronicle endorsement matrix cell");
assertIncludes(governor, "data-position-kind=\"no-public-position\"", "honest no-public-position matrix cells");
assertIncludes(governor, "data-receipt-empty-reason=\"no-public-position\"", "no-public-position receipt marker");
assertIncludes(governor, "data-source-id=\"src-growsf\"", "GrowSF empty-source marker for hidden governor claim");
assertIncludes(governor, "data-candidate-id=\"ent-california-governor-matt-mahan\"", "Matt Mahan hidden-claim candidate marker");

assertCommonRaceSurface(usHouse, "us-house-district-11", "U.S. House District 11");
assertIncludes(usHouse, "GrowSF", "GrowSF source label");
assertIncludes(usHouse, "Scott Wiener", "Scott Wiener candidate label");
assertIncludes(usHouse, "data-source-id=\"src-growsf\"", "GrowSF source marker");
assertIncludes(usHouse, "data-candidate-id=\"ent-us-house-district-11-scott-wiener\"", "Scott Wiener candidate marker");
assertIncludes(usHouse, "data-position-kind=\"endorse\"", "GrowSF/Scott Wiener endorsement marker");
assertIncludes(usHouse, "data-receipt-status=\"available\"", "GrowSF/Scott Wiener available evidence receipt marker");
assertMatches(usHouse, /Scott Wiener[\s\S]{0,1200}(?:1|[2-9][0-9]*) evidence|(?:1|[2-9][0-9]*) evidence[\s\S]{0,1200}Scott Wiener/i, "Scott Wiener evidence count copy");

const forbiddenPatterns = [
  [/Sample Candidate/i, "sample candidate leakage"],
  [/sample-voter-guide/i, "sample voter-guide URL leakage"],
  [/(?:^|[\s/"'])mayor(?:[\s/"']|$)/i, "stale Mayor fixture leakage"],
  [/\/debug\//i, "debug route link leakage"],
  [/Visible diagnostics/i, "public diagnostic heading"],
  [/Checked public data files/i, "checked-file disclosure heading"],
  [/manual\/(?:reviews|overrides)\//i, "private manual review path"],
  [/data\/(?:public|extracted|ingested|reviewed)\//i, "private data path"],
  [/\.gsd\//i, "private GSD path"],
  [/\/home\//i, "absolute local path"],
  [/file:\/\//i, "file URL path"],
];

for (const route of representativeRoutes) {
  for (const [pattern, description] of forbiddenPatterns) assertExcludes(route.filePath, route.html, pattern, description);
}

for (const filePath of htmlFiles) {
  const html = readFileSync(filePath, "utf8");
  for (const [pattern, description] of forbiddenPatterns) {
    assertExcludes(filePath, html, pattern, description);
  }
}

console.log(
  `M004/S04 public route export assertions passed: checked State Assembly District 17, California Governor, U.S. House District 11, and ${htmlFiles.length} HTML files for private/debug/sample leakage.`,
);
