#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_ORIGIN = "https://votes.yayarea.news";
export const DEFAULT_OUT_DIR = "out";
export const DEFAULT_REPORT_PATH = "data/launch/s07-export-assertions.json";
export const EXPECTED_REGISTERED_SOURCE_COUNT = 24;

export const REQUIRED_PUBLIC_JSON_PATHS = [
  "data/public/ballot-universe.json",
  "data/public/sources.json",
  "data/public/entities.json",
  "data/public/source-race-coverage.json",
];

export const FORBIDDEN_LEAKAGE_PATTERNS = [
  { id: "private_gsd_path", description: "private GSD path", pattern: /(?:^|[\s"'>(/])\.gsd(?:\/|[\s"'<)]|$)/i },
  { id: "absolute_local_path", description: "absolute local path", pattern: /\/home\//i },
  { id: "file_url", description: "file URL path", pattern: /file:\/\//i },
  { id: "private_manual_review_path", description: "private manual or review path", pattern: /(?:manual\/(?:reviews|overrides)|review\/positions|review\/coverage|\.planning\/|\.audits\/)/i },
  { id: "private_diagnostics", description: "draft-only or private diagnostics", pattern: /(?:draft-only|private diagnostics|local diagnostics|checkedFiles|checked-file|data-checked-file-count|manual override)/i },
  { id: "debug_route", description: "debug route leakage", pattern: /\/debug(?:\/|["'?#\s<]|$)/i },
  { id: "review_route", description: "review route leakage", pattern: /\/review(?:\/|["'?#\s<]|$)/i },
  { id: "sample_candidate", description: "stale sample candidate fixture copy", pattern: /Sample Candidate/i },
  { id: "sample_voter_guide", description: "stale sample voter-guide fixture URL", pattern: /sample-voter-guide/i },
  { id: "stale_mayor_fixture", description: "stale sample mayor fixture copy", pattern: /(?:out\/races\/mayor|\/races\/mayor\/|data-race-slug=["']mayor["']|\bmayor race\b)/i },
];

function fail(phase, message) {
  console.error(`[assert-s07-export:${phase}] ${message}`);
  process.exit(1);
}

function readJson(projectRoot, relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  if (!existsSync(fullPath)) throw new Error(`missing required JSON ${relativePath}`);
  let raw;
  try {
    raw = readFileSync(fullPath, "utf8");
  } catch (error) {
    throw new Error(`unable to read ${relativePath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`malformed JSON ${relativePath}: ${error.message}`);
  }
}

export function normalizeRoute(route) {
  if (!route || route === "/") return "/";
  const withoutHash = String(route).split("#")[0].split("?")[0];
  const withLeadingSlash = withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function htmlPathForRoute(route, outDir = DEFAULT_OUT_DIR) {
  const normalized = normalizeRoute(route);
  const clean = normalized.replace(/^\//, "").replace(/\/$/, "");
  const candidates = clean === "" ? [path.join(outDir, "index.html")] : [path.join(outDir, clean, "index.html"), path.join(outDir, `${clean}.html`)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function routeToExpectedExportPath(route, outDir = DEFAULT_OUT_DIR) {
  const normalized = normalizeRoute(route);
  if (normalized === "/") return path.join(outDir, "index.html");
  return path.join(outDir, normalized.replace(/^\//, ""), "index.html");
}

export function listHtmlFiles(dir = DEFAULT_OUT_DIR) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const filePath = path.join(dir, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) files.push(...listHtmlFiles(filePath));
    else if (entry.endsWith(".html")) files.push(filePath);
  }
  return files;
}

export function routeFromHtmlPath(filePath, outDir = DEFAULT_OUT_DIR) {
  const relative = path.relative(outDir, filePath).replaceAll(path.sep, "/");
  if (relative === "index.html") return "/";
  if (relative.endsWith("/index.html")) return normalizeRoute(relative.slice(0, -"index.html".length));
  if (relative.endsWith(".html")) return normalizeRoute(relative.slice(0, -".html".length));
  return normalizeRoute(relative);
}

export function classifyHref(href, sourceRoute = "/", origin = DEFAULT_ORIGIN) {
  if (!href) return { kind: "ignored", reason: "empty" };
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return { kind: "ignored", reason: "fragment" };
  if (/^(?:mailto|tel|javascript|data|blob):/i.test(trimmed)) return { kind: "ignored", reason: "scheme" };

  let url;
  try {
    url = new URL(trimmed, `${origin}${normalizeRoute(sourceRoute)}`);
  } catch {
    return { kind: "ignored", reason: "malformed" };
  }

  if (url.origin !== origin) return { kind: "external", href: trimmed, origin: url.origin };
  return { kind: "internal", href: trimmed, route: normalizeRoute(url.pathname) };
}

export function extractAnchorHrefs(html) {
  return [...html.matchAll(/<a\b[^>]*\shref=(['"])(.*?)\1/gi)].map((match) => match[2]);
}

export function findBrokenInternalLinks(htmlFiles, outDir = DEFAULT_OUT_DIR, origin = DEFAULT_ORIGIN) {
  const broken = [];
  for (const sourceHtml of htmlFiles) {
    const sourceRoute = routeFromHtmlPath(sourceHtml, outDir);
    const html = readFileSync(sourceHtml, "utf8");
    for (const href of extractAnchorHrefs(html)) {
      const classified = classifyHref(href, sourceRoute, origin);
      if (classified.kind !== "internal") continue;
      if (!htmlPathForRoute(classified.route, outDir)) broken.push({ sourceHtml, sourceRoute, href, targetRoute: classified.route });
    }
  }
  return broken;
}

export function findForbiddenLeakagesInHtml(htmlByPath, patterns = FORBIDDEN_LEAKAGE_PATTERNS) {
  const findings = [];
  for (const [filePath, html] of Object.entries(htmlByPath)) {
    for (const check of patterns) {
      const match = check.pattern.exec(html);
      if (match) findings.push({ filePath, id: check.id, description: check.description, match: match[0] });
    }
  }
  return findings;
}

export function findLocalOnlyRouteArtifacts(outDir = DEFAULT_OUT_DIR) {
  return ["debug", "review"].map((segment) => path.join(outDir, segment)).filter((candidate) => existsSync(candidate));
}

export function discoverS07RouteContractsFromData({ ballotUniverse, sources, entities, sourceRaceCoverage, raceRecords }) {
  const issues = [];
  const sourceList = Array.isArray(sources?.sources) ? sources.sources : [];
  const entityList = Array.isArray(entities?.entities) ? entities.entities : [];
  const registeredSourceIds = sourceList.map((source) => source.id).filter(Boolean).sort();
  const sourceById = new Map(sourceList.map((source) => [source.id, source]));
  const entityById = new Map(entityList.map((entity) => [entity.id, entity]));
  const publicRaces = (ballotUniverse?.trackedRaces ?? []).filter((race) => race.publicationStatus === "public");

  if (registeredSourceIds.length !== EXPECTED_REGISTERED_SOURCE_COUNT) issues.push(`data/public/sources.json has ${registeredSourceIds.length} registered sources; expected ${EXPECTED_REGISTERED_SOURCE_COUNT}`);
  if (sourceRaceCoverage?.counts?.registeredSourceCount !== EXPECTED_REGISTERED_SOURCE_COUNT) issues.push(`data/public/source-race-coverage.json counts.registeredSourceCount is ${sourceRaceCoverage?.counts?.registeredSourceCount}; expected ${EXPECTED_REGISTERED_SOURCE_COUNT}`);
  if (publicRaces.length === 0) issues.push("route class race: no public tracked races discovered in data/public/ballot-universe.json");

  const coverageByRace = normalizeCoverageByRace(sourceRaceCoverage?.byRace);
  const coverageContracts = [];
  for (const race of publicRaces) {
    const coverage = coverageByRace.get(race.slug) ?? coverageByRace.get(race.raceId) ?? coverageByRace.get(race.id);
    if (!coverage) {
      issues.push(`coverage ${race.slug}: missing source-race-coverage row`);
      continue;
    }
    const rows = Array.isArray(coverage.sources) ? coverage.sources : [];
    if (rows.length !== EXPECTED_REGISTERED_SOURCE_COUNT) issues.push(`coverage ${race.slug}: expected ${EXPECTED_REGISTERED_SOURCE_COUNT} source rows, found ${rows.length}`);
    const coverageIds = rows.map((row) => row.sourceId).filter(Boolean).sort();
    const missingIds = registeredSourceIds.filter((sourceId) => !coverageIds.includes(sourceId));
    const unexpectedIds = coverageIds.filter((sourceId) => !registeredSourceIds.includes(sourceId));
    if (missingIds.length > 0) issues.push(`coverage ${race.slug}: missing registered sources ${summarizeList(missingIds)}`);
    if (unexpectedIds.length > 0) issues.push(`coverage ${race.slug}: unexpected source rows ${summarizeList(unexpectedIds)}`);
    const unresolvedRows = rows.filter((row) => ["pending-capture", "awaiting-review", "manual-only", "no-public-source-found", "no-public-position-found", "not-applicable"].includes(row.status));
    const unlabeledRows = unresolvedRows.filter((row) => !row.reason && !row.notes && !row.ledgerStatus);
    if (unlabeledRows.length > 0) issues.push(`coverage ${race.slug}: unresolved source rows need honest reason/status labels ${summarizeList(unlabeledRows.map((row) => row.sourceId ?? "unknown"))}`);
    const reviewedRows = rows.filter((row) => row.status === "reviewed-public-position");
    const countSum = Object.values(coverage.counts ?? {}).reduce((sum, value) => sum + (Number.isInteger(value) ? value : 0), 0);
    if (countSum !== rows.length) issues.push(`coverage ${race.slug}: coverage counts sum to ${countSum}, but sources has ${rows.length} rows`);
    coverageContracts.push({ raceSlug: race.slug, rowCount: rows.length, reviewedRowCount: reviewedRows.length, unresolvedRowCount: unresolvedRows.length });
  }

  const raceRecordBySlug = new Map((raceRecords ?? []).map((record) => [record?.race?.slug, record]));
  const publicSourceIds = new Set();
  const publicEntityIds = new Set();
  for (const record of raceRecords ?? []) {
    const race = record?.race;
    if (!race || race.publicationStatus !== "public") continue;
    if (!raceRecordBySlug.has(race.slug)) issues.push(`route class race: malformed public race record for ${race.slug ?? "unknown"}`);
    for (const position of race.positions ?? []) {
      if (position.publicationStatus !== "public") continue;
      if (position.sourceId) publicSourceIds.add(position.sourceId);
      if (position.entityId) publicEntityIds.add(position.entityId);
    }
  }

  const routes = [
    { route: "/", className: "homepage", label: "homepage", requiredText: ["votes.yayarea.news", "Public races"], requiredPatterns: [/<title[^>]*>[^<]+<\/title>/i] },
    { route: "/how-we-use-ai/", className: "disclosure", label: "AI disclosure", requiredText: ["How we use AI", "What AI helps with", "What humans review"], requiredPatterns: [/data-disclosure-route=["']how-we-use-ai["']/i] },
  ];

  for (const race of publicRaces) {
    routes.push({
      route: `/races/${race.slug}/`,
      className: "race",
      slug: race.slug,
      label: race.title,
      requiredText: [race.title, "Source-by-candidate comparison", "public sources"],
      requiredPatterns: [new RegExp(`data-race-slug=["']${escapeRegExp(race.slug)}["']`, "i"), /data-matrix-source-count=["']\d+["']/i, /data-receipt-status=["'](?:available|unavailable)["']/i],
    });
  }

  if (publicSourceIds.size === 0) issues.push("route class source: no public source IDs discovered from data/public/races/*.json positions");
  for (const sourceId of [...publicSourceIds].sort()) {
    const source = sourceById.get(sourceId);
    if (!source?.slug) {
      issues.push(`route class source: ${sourceId} is referenced by public positions but missing from data/public/sources.json`);
      continue;
    }
    routes.push({ route: `/sources/${source.slug}/`, className: "source", slug: source.slug, label: source.name, requiredText: [source.name, "Published recommendation trail"], requiredPatterns: [/data-drilldown-kind=["']source["']/i, /data-recommendation-count=["']\d+["']/i] });
  }

  if (publicEntityIds.size === 0) issues.push("route class entity: no public entity IDs discovered from data/public/races/*.json positions");
  for (const entityId of [...publicEntityIds].sort()) {
    const entity = entityById.get(entityId);
    if (!entity?.slug) {
      issues.push(`route class entity: ${entityId} is referenced by public positions but missing from data/public/entities.json`);
      continue;
    }
    routes.push({ route: `/entities/${entity.slug}/`, className: "entity", slug: entity.slug, label: entity.name, requiredText: [entity.name, "Published recommendation trail"], requiredPatterns: [/data-drilldown-kind=["']entity["']/i, /data-recommendation-count=["']\d+["']/i] });
  }

  const routeKeys = new Set();
  for (const contract of routes) {
    const validationErrors = validateRouteContract(contract);
    if (validationErrors.length > 0) issues.push(`${contract.route ?? "<missing route>"}: ${validationErrors.join(", ")}`);
    const key = normalizeRoute(contract.route);
    if (routeKeys.has(key)) issues.push(`duplicate route contract ${key}`);
    routeKeys.add(key);
  }

  const classCounts = routes.reduce((counts, route) => ({ ...counts, [route.className]: (counts[route.className] ?? 0) + 1 }), {});
  for (const className of ["homepage", "race", "source", "entity", "disclosure"]) {
    if (!classCounts[className]) issues.push(`route class ${className}: no route contract discovered`);
  }

  return { routes, issues, classCounts, coverageContracts };
}

export function loadS07RouteContracts(projectRoot = process.cwd()) {
  const [ballotUniverse, sources, entities, sourceRaceCoverage] = REQUIRED_PUBLIC_JSON_PATHS.map((relativePath) => readJson(projectRoot, relativePath));
  const raceRecords = [];
  for (const race of ballotUniverse.trackedRaces ?? []) {
    if (race.publicationStatus !== "public") continue;
    const racePath = `data/public/races/${race.slug}.json`;
    try {
      raceRecords.push(readJson(projectRoot, racePath));
    } catch (error) {
      throw new Error(`race ${race.slug}: ${error.message}`);
    }
  }
  return discoverS07RouteContractsFromData({ ballotUniverse, sources, entities, sourceRaceCoverage, raceRecords });
}

export function validateRouteContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object") return ["route contract must be an object"];
  if (!contract.route || normalizeRoute(contract.route) !== contract.route) errors.push("route must be normalized with leading and trailing slash");
  if (!contract.className || !["homepage", "race", "source", "entity", "disclosure"].includes(contract.className)) errors.push("className must be homepage, race, source, entity, or disclosure");
  if (!contract.label || typeof contract.label !== "string") errors.push("label is required");
  if (!Array.isArray(contract.requiredText)) errors.push("requiredText must be an array");
  if (!Array.isArray(contract.requiredPatterns)) errors.push("requiredPatterns must be an array");
  return errors;
}

export function assertRouteHtmlContracts(routes, outDir = DEFAULT_OUT_DIR, origin = DEFAULT_ORIGIN) {
  const checked = [];
  const failures = [];
  for (const contract of routes) {
    const exportPath = htmlPathForRoute(contract.route, outDir);
    if (!exportPath) {
      failures.push(`missing ${contract.className} route ${contract.route} (${contract.label}); expected ${routeToExpectedExportPath(contract.route, outDir)}`);
      continue;
    }
    const html = readFileSync(exportPath, "utf8");
    const canonical = `${origin}${normalizeRoute(contract.route)}`;
    const titleOk = /<title[^>]*>[^<]+<\/title>/i.test(html);
    const canonicalOk = new RegExp(`<link[^>]+rel=["']canonical["'][^>]+href=["']${escapeRegExp(canonical)}["']|<link[^>]+href=["']${escapeRegExp(canonical)}["'][^>]+rel=["']canonical["']`, "i").test(html);
    const missingText = (contract.requiredText ?? []).filter((text) => !html.includes(text));
    const missingPatterns = (contract.requiredPatterns ?? []).filter((pattern) => !pattern.test(html)).map((pattern) => String(pattern));
    if (!titleOk) failures.push(`${contract.route} (${exportPath}) is missing a <title>`);
    if (!canonicalOk) failures.push(`${contract.route} (${exportPath}) is missing canonical ${canonical}`);
    for (const text of missingText) failures.push(`${contract.route} (${exportPath}) is missing route content ${JSON.stringify(text)}`);
    for (const pattern of missingPatterns) failures.push(`${contract.route} (${exportPath}) is missing required marker ${pattern}`);
    checked.push({
      route: contract.route,
      className: contract.className,
      exportPath,
      status: titleOk && canonicalOk && missingText.length === 0 && missingPatterns.length === 0 ? "pass" : "fail",
      htmlBytes: Buffer.byteLength(html),
      hasTitle: titleOk,
      hasCanonical: canonicalOk,
      missingText,
      missingPatterns,
    });
  }
  return { checked, failures };
}

export function validateS07ExportReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["report must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.slice !== "S07") errors.push("slice must be S07");
  if (report.generatedBy !== "scripts/assert-s07-export.mjs") errors.push("generatedBy must identify the S07 assertion script");
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (report.status !== "pass") errors.push("status must be pass");
  for (const key of ["htmlFiles", "routes", "linksChecked", "brokenLinks", "leakFindings", "localOnlyRouteArtifacts", "coverageRaceContracts"]) {
    if (!Number.isInteger(report.counts?.[key]) || report.counts[key] < 0) errors.push(`counts.${key} must be a non-negative integer`);
  }
  if (!Array.isArray(report.checkedRoutes) || report.checkedRoutes.length === 0) errors.push("checkedRoutes must be a non-empty array");
  if (!Array.isArray(report.coverageContracts) || report.coverageContracts.length === 0) errors.push("coverageContracts must be a non-empty array");
  for (const finding of findForbiddenStringsInObject(report)) errors.push(`report leaked ${finding.description}: ${finding.match}`);
  return errors;
}

export function runS07ExportAssertions({ projectRoot = process.cwd(), outDir = path.join(projectRoot, DEFAULT_OUT_DIR), reportPath = path.join(projectRoot, DEFAULT_REPORT_PATH), origin = DEFAULT_ORIGIN } = {}) {
  if (!existsSync(outDir)) throw new Error(`preflight: Missing static export directory ${path.relative(projectRoot, outDir) || outDir}/. Run pnpm build before this assertion.`);
  const htmlFiles = listHtmlFiles(outDir);
  if (htmlFiles.length === 0) throw new Error(`preflight: Missing static export HTML files under ${path.relative(projectRoot, outDir) || outDir}/. Run pnpm build before this assertion.`);

  const localOnlyArtifacts = findLocalOnlyRouteArtifacts(outDir);
  if (localOnlyArtifacts.length > 0) throw new Error(`local-only-routes: final artifact must not include ${localOnlyArtifacts.map((filePath) => path.relative(projectRoot, filePath).replaceAll(path.sep, "/")).join(", ")}`);

  let contracts;
  try {
    contracts = loadS07RouteContracts(projectRoot);
  } catch (error) {
    throw new Error(`route-discovery: ${error.message}`);
  }
  if (contracts.issues.length > 0) throw new Error(`route-discovery: ${contracts.issues.join("; ")}`);

  const routeChecks = assertRouteHtmlContracts(contracts.routes, outDir, origin);
  if (routeChecks.failures.length > 0) throw new Error(`route-contract: ${routeChecks.failures.join("; ")}`);

  const brokenLinks = findBrokenInternalLinks(htmlFiles, outDir, origin);
  if (brokenLinks.length > 0) {
    throw new Error(`internal-links: ${brokenLinks.map((link) => `${path.relative(projectRoot, link.sourceHtml).replaceAll(path.sep, "/")} href=${link.href} target=${link.targetRoute}`).join("; ")}`);
  }

  const htmlByPath = Object.fromEntries(htmlFiles.map((filePath) => [path.relative(projectRoot, filePath).replaceAll(path.sep, "/"), readFileSync(filePath, "utf8")]));
  const leakFindings = findForbiddenLeakagesInHtml(htmlByPath);
  if (leakFindings.length > 0) {
    throw new Error(`public-private-leakage: ${leakFindings.map((finding) => `${finding.filePath} ${finding.description} (${finding.id}) matched ${JSON.stringify(finding.match)}`).join("; ")}`);
  }

  const linksChecked = htmlFiles.reduce((count, filePath) => count + extractAnchorHrefs(readFileSync(filePath, "utf8")).filter((href) => classifyHref(href, routeFromHtmlPath(filePath, outDir), origin).kind === "internal").length, 0);
  const report = {
    schemaVersion: 1,
    slice: "S07",
    generatedBy: "scripts/assert-s07-export.mjs",
    generatedAt: new Date().toISOString(),
    status: "pass",
    origin,
    counts: {
      htmlFiles: htmlFiles.length,
      routes: routeChecks.checked.length,
      routeClasses: contracts.classCounts,
      linksChecked,
      brokenLinks: 0,
      leakFindings: 0,
      localOnlyRouteArtifacts: 0,
      coverageRaceContracts: contracts.coverageContracts.length,
    },
    checkedRoutes: routeChecks.checked.map((route) => ({ ...route, exportPath: path.relative(projectRoot, route.exportPath).replaceAll(path.sep, "/") })),
    coverageContracts: contracts.coverageContracts,
    phases: {
      preflight: { status: "pass" },
      routeDiscovery: { status: "pass", classCounts: contracts.classCounts, coverageRaceContracts: contracts.coverageContracts.length },
      routeContracts: { status: "pass" },
      internalLinks: { status: "pass", checked: linksChecked },
      publicPrivateLeakage: { status: "pass", checks: FORBIDDEN_LEAKAGE_PATTERNS.map(({ id, description }) => ({ id, description, status: "pass" })) },
      localOnlyRoutes: { status: "pass", forbidden: ["out/debug", "out/review"] },
    },
  };

  const reportErrors = validateS07ExportReport(report);
  if (reportErrors.length > 0) throw new Error(`launch-report: ${reportErrors.join("; ")}`);

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function normalizeCoverageByRace(byRace) {
  const entries = Array.isArray(byRace) ? byRace.map((entry) => [entry.raceSlug ?? entry.raceId, entry]) : Object.entries(byRace ?? {});
  return new Map(entries.filter(([key]) => key));
}

function summarizeList(values, max = 8) {
  const list = [...values];
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} (+${list.length - max} more)`;
}

function findForbiddenStringsInObject(value) {
  const findings = [];
  const visit = (item, key = "") => {
    if (typeof item === "string") {
      for (const check of FORBIDDEN_LEAKAGE_PATTERNS.filter((entry) => ["private_gsd_path", "absolute_local_path", "file_url"].includes(entry.id))) {
        const match = check.pattern.exec(item);
        if (match) findings.push({ key, id: check.id, description: check.description, match: match[0] });
      }
      return;
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) item.forEach((child, index) => visit(child, `${key}[${index}]`));
    else for (const [childKey, child] of Object.entries(item)) visit(child, key ? `${key}.${childKey}` : childKey);
  };
  visit(value);
  return findings;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phaseFromError(error) {
  const message = error?.message ?? String(error);
  const match = /^(preflight|local-only-routes|route-discovery|route-contract|internal-links|public-private-leakage|launch-report):\s*/.exec(message);
  return match?.[1] ?? "runtime";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = runS07ExportAssertions();
    console.log(
      `S07 export assertions passed: ${report.counts.routes} route contracts, ${report.counts.coverageRaceContracts} race coverage contracts, ${report.counts.htmlFiles} HTML files, ${report.counts.linksChecked} internal links; wrote ${DEFAULT_REPORT_PATH}.`,
    );
  } catch (error) {
    fail(phaseFromError(error), error.message.replace(/^(?:preflight|local-only-routes|route-discovery|route-contract|internal-links|public-private-leakage|launch-report):\s*/, ""));
  }
}
