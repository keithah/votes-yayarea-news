#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_ORIGIN = "https://votes.yayarea.news";
export const DEFAULT_OUT_DIR = "out";
export const DEFAULT_REPORT_PATH = "data/launch/s05-launch-export.json";

export const FORBIDDEN_LEAKAGE_PATTERNS = [
  { id: "sample_candidate", description: "sample candidate leakage", pattern: /Sample Candidate/i },
  { id: "sample_voter_guide", description: "sample voter-guide URL leakage", pattern: /sample-voter-guide/i },
  { id: "stale_mayor_fixture", description: "stale Mayor fixture leakage", pattern: /(?:^|[\s/"'])mayor(?:[\s/"']|$)/i },
  { id: "debug_route", description: "debug route link leakage", pattern: /\/debug\//i },
  { id: "private_manual_review_path", description: "private manual review path", pattern: /manual\/(?:reviews|overrides)\//i },
  { id: "private_data_path", description: "private data path", pattern: /data\/(?:public|extracted|ingested)\//i },
  { id: "private_gsd_path", description: "private GSD path", pattern: /\.gsd\//i },
  { id: "absolute_local_path", description: "absolute local path", pattern: /\/home\//i },
  { id: "file_url", description: "file URL path", pattern: /file:\/\//i },
  {
    id: "directive_endorsement",
    description: "product-authored directive endorsement phrase",
    pattern: /\b(?:vote\s+for|must\s+support|we\s+recommend|our\s+pick|best\s+choice)\b/i,
  },
];

function fail(phase, message) {
  console.error(`[assert-s05-launch-export:${phase}] ${message}`);
  process.exit(1);
}

function readJson(projectRoot, relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  try {
    return JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${relativePath}: ${error.message}`);
  }
}

export function normalizeRoute(route) {
  if (!route || route === "/") return "/";
  const withoutHash = String(route).split("#")[0].split("?")[0];
  const withLeadingSlash = withoutHash.startsWith("/") ? withoutHash : `/${withoutHash}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function routeToExportPath(route, outDir = DEFAULT_OUT_DIR) {
  const normalized = normalizeRoute(route);
  if (normalized === "/") return path.join(outDir, "index.html");
  return path.join(outDir, normalized.replace(/^\//, ""), "index.html");
}

export function htmlPathForRoute(route, outDir = DEFAULT_OUT_DIR) {
  const normalized = normalizeRoute(route);
  const clean = normalized.replace(/^\//, "").replace(/\/$/, "");
  const candidates = clean === "" ? [path.join(outDir, "index.html")] : [path.join(outDir, clean, "index.html"), path.join(outDir, `${clean}.html`)];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
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

export function discoverRouteContractsFromData({ ballotUniverse, sources, entities, raceRecords }) {
  const issues = [];
  const sourceById = new Map((sources?.sources ?? []).map((source) => [source.id, source]));
  const entityById = new Map((entities?.entities ?? []).map((entity) => [entity.id, entity]));
  const publicRaces = (ballotUniverse?.trackedRaces ?? []).filter((race) => race.publicationStatus === "public");

  if (publicRaces.length === 0) issues.push("route class race: no public tracked races discovered in data/public/ballot-universe.json");

  const routes = [
    { route: "/", className: "homepage", label: "homepage", requiredText: ["votes.yayarea.news"] },
    { route: "/how-we-use-ai/", className: "disclosure", label: "AI disclosure", requiredText: ["How we use AI"] },
  ];

  for (const race of publicRaces) {
    routes.push({ route: `/races/${race.slug}/`, className: "race", slug: race.slug, label: race.title, requiredText: [race.title] });
  }

  const publicSourceIds = new Set();
  const publicEntityIds = new Set();
  for (const record of raceRecords ?? []) {
    const race = record?.race;
    if (!race || race.publicationStatus !== "public") continue;
    for (const position of race.positions ?? []) {
      if (position.publicationStatus !== "public") continue;
      if (position.sourceId) publicSourceIds.add(position.sourceId);
      if (position.entityId) publicEntityIds.add(position.entityId);
    }
  }

  if (publicSourceIds.size === 0) issues.push("route class source: no public source IDs discovered from data/public/races/*.json positions");
  if (publicEntityIds.size === 0) issues.push("route class entity: no public entity IDs discovered from data/public/races/*.json positions");

  for (const sourceId of [...publicSourceIds].sort()) {
    const source = sourceById.get(sourceId);
    if (!source?.slug) {
      issues.push(`route class source: ${sourceId} is referenced by public positions but missing from data/public/sources.json`);
      continue;
    }
    routes.push({ route: `/sources/${source.slug}/`, className: "source", slug: source.slug, label: source.name, requiredText: [source.name, "Published position receipts"] });
  }

  for (const entityId of [...publicEntityIds].sort()) {
    const entity = entityById.get(entityId);
    if (!entity?.slug) {
      issues.push(`route class entity: ${entityId} is referenced by public positions but missing from data/public/entities.json`);
      continue;
    }
    routes.push({ route: `/entities/${entity.slug}/`, className: "entity", slug: entity.slug, label: entity.name, requiredText: [entity.name, "Published position receipts"] });
  }

  const classCounts = routes.reduce((counts, route) => ({ ...counts, [route.className]: (counts[route.className] ?? 0) + 1 }), {});
  for (const className of ["homepage", "race", "source", "entity", "disclosure"]) {
    if (!classCounts[className]) issues.push(`route class ${className}: no route contract discovered`);
  }

  return { routes, issues, classCounts };
}

export function loadRouteContracts(projectRoot = process.cwd()) {
  const ballotUniverse = readJson(projectRoot, "data/public/ballot-universe.json");
  const sources = readJson(projectRoot, "data/public/sources.json");
  const entities = readJson(projectRoot, "data/public/entities.json");
  const raceRecords = [];
  for (const race of ballotUniverse.trackedRaces ?? []) {
    if (race.publicationStatus !== "public") continue;
    const racePath = `data/public/races/${race.slug}.json`;
    try {
      raceRecords.push(readJson(projectRoot, racePath));
    } catch (error) {
      throw new Error(`route class race ${race.slug}: ${error.message}`);
    }
  }
  return discoverRouteContractsFromData({ ballotUniverse, sources, entities, raceRecords });
}

export function classifyHref(href, sourceRoute = "/", origin = DEFAULT_ORIGIN) {
  if (!href) return { kind: "ignored", reason: "empty" };
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return { kind: "ignored", reason: "fragment" };
  if (/^(?:mailto|tel|javascript|data):/i.test(trimmed)) return { kind: "ignored", reason: "scheme" };

  let url;
  try {
    url = new URL(trimmed, `${origin}${normalizeRoute(sourceRoute)}`);
  } catch {
    return { kind: "ignored", reason: "malformed" };
  }

  if (url.origin !== origin) return { kind: "external", href: trimmed, origin: url.origin };
  const route = normalizeRoute(`${url.pathname}${url.search}`);
  return { kind: "internal", href: trimmed, route };
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
      if (!htmlPathForRoute(classified.route, outDir)) {
        broken.push({ sourceHtml, sourceRoute, href, targetRoute: classified.route });
      }
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

export function assertRouteHtmlContracts(routes, outDir = DEFAULT_OUT_DIR, origin = DEFAULT_ORIGIN) {
  const checked = [];
  const failures = [];
  for (const contract of routes) {
    const exportPath = htmlPathForRoute(contract.route, outDir);
    if (!exportPath) {
      failures.push(`missing ${contract.className} route ${contract.route} (${contract.label})`);
      continue;
    }
    const html = readFileSync(exportPath, "utf8");
    const titleOk = /<title[^>]*>[^<]+<\/title>/i.test(html);
    const canonical = `${origin}${normalizeRoute(contract.route)}`;
    const canonicalOk = new RegExp(`<link[^>]+rel=["']canonical["'][^>]+href=["']${escapeRegExp(canonical)}["']`, "i").test(html);
    const missingText = (contract.requiredText ?? []).filter((text) => !html.includes(text));
    if (!titleOk) failures.push(`${contract.route} is missing a <title>`);
    if (!canonicalOk) failures.push(`${contract.route} is missing canonical ${canonical}`);
    for (const text of missingText) failures.push(`${contract.route} is missing route content ${JSON.stringify(text)}`);
    checked.push({ route: contract.route, className: contract.className, exportPath, status: titleOk && canonicalOk && missingText.length === 0 ? "pass" : "fail", htmlBytes: Buffer.byteLength(html), hasTitle: titleOk, hasCanonical: canonicalOk, missingText });
  }
  return { checked, failures };
}

export function validateS05LaunchReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["report must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.slice !== "S05") errors.push("slice must be S05");
  if (report.generatedBy !== "scripts/assert-s05-launch-export.mjs") errors.push("generatedBy must identify the S05 assertion script");
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (!report.counts || typeof report.counts !== "object") errors.push("counts object is required");
  for (const key of ["htmlFiles", "routes", "linksChecked", "brokenLinks", "leakFindings"]) {
    if (!Number.isInteger(report.counts?.[key]) || report.counts[key] < 0) errors.push(`counts.${key} must be a non-negative integer`);
  }
  if (!Array.isArray(report.checkedRoutes) || report.checkedRoutes.length === 0) errors.push("checkedRoutes must be a non-empty array");
  if (report.status !== "pass") errors.push("status must be pass");
  for (const finding of findForbiddenStringsInObject(report)) errors.push(`report leaked ${finding.description}: ${finding.match}`);
  return errors;
}

export function runS05LaunchExportAssertions({ projectRoot = process.cwd(), outDir = path.join(projectRoot, DEFAULT_OUT_DIR), reportPath = path.join(projectRoot, DEFAULT_REPORT_PATH), origin = DEFAULT_ORIGIN } = {}) {
  if (!existsSync(outDir)) throw new Error(`preflight: Missing static export directory ${path.relative(projectRoot, outDir) || outDir}/. Run pnpm build before this assertion.`);

  const htmlFiles = listHtmlFiles(outDir);
  if (htmlFiles.length === 0) throw new Error(`preflight: Missing static export HTML files under ${path.relative(projectRoot, outDir) || outDir}/. Run pnpm build before this assertion.`);

  const contracts = loadRouteContracts(projectRoot);
  if (contracts.issues.length > 0) throw new Error(`route-discovery: ${contracts.issues.join("; ")}`);

  const routeChecks = assertRouteHtmlContracts(contracts.routes, outDir, origin);
  if (routeChecks.failures.length > 0) throw new Error(`route-contract: ${routeChecks.failures.join("; ")}`);

  const brokenLinks = findBrokenInternalLinks(htmlFiles, outDir, origin);
  if (brokenLinks.length > 0) {
    throw new Error(`internal-links: ${brokenLinks.map((link) => `${path.relative(projectRoot, link.sourceHtml)} href=${link.href} target=${link.targetRoute}`).join("; ")}`);
  }

  const htmlByPath = Object.fromEntries(htmlFiles.map((filePath) => [path.relative(projectRoot, filePath), readFileSync(filePath, "utf8")]));
  const leakFindings = findForbiddenLeakagesInHtml(htmlByPath);
  if (leakFindings.length > 0) {
    throw new Error(`public-trust-leakage: ${leakFindings.map((finding) => `${finding.filePath} ${finding.description} (${finding.id}) matched ${JSON.stringify(finding.match)}`).join("; ")}`);
  }

  const linksChecked = htmlFiles.reduce((count, filePath) => count + extractAnchorHrefs(readFileSync(filePath, "utf8")).filter((href) => classifyHref(href, routeFromHtmlPath(filePath, outDir), origin).kind === "internal").length, 0);
  const report = {
    schemaVersion: 1,
    slice: "S05",
    generatedBy: "scripts/assert-s05-launch-export.mjs",
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
    },
    checkedRoutes: routeChecks.checked.map((route) => ({ ...route, exportPath: path.relative(projectRoot, route.exportPath).replaceAll(path.sep, "/") })),
    phases: {
      preflight: { status: "pass" },
      routeDiscovery: { status: "pass", classCounts: contracts.classCounts },
      routeContracts: { status: "pass" },
      internalLinks: { status: "pass", checked: linksChecked },
      publicTrustLeakage: { status: "pass", checks: FORBIDDEN_LEAKAGE_PATTERNS.map(({ id, description }) => ({ id, description, status: "pass" })) },
    },
  };

  const reportErrors = validateS05LaunchReport(report);
  if (reportErrors.length > 0) throw new Error(`launch-report: ${reportErrors.join("; ")}`);

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
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
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phaseFromError(error) {
  const message = error?.message ?? String(error);
  const match = /^(preflight|route-discovery|route-contract|internal-links|public-trust-leakage|launch-report):\s*/.exec(message);
  return match?.[1] ?? "runtime";
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : fileURLToPath(import.meta.url)).href) {
  try {
    const report = runS05LaunchExportAssertions();
    console.log(
      `S05 launch export assertions passed: ${report.counts.routes} route contracts, ${report.counts.htmlFiles} HTML files, ${report.counts.linksChecked} internal links; wrote ${DEFAULT_REPORT_PATH}.`,
    );
  } catch (error) {
    fail(phaseFromError(error), error.message.replace(/^(?:preflight|route-discovery|route-contract|internal-links|public-trust-leakage|launch-report):\s*/, ""));
  }
}
