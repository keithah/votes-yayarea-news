#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path, { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_ORIGIN = "https://keithah.github.io/votes-yayarea-news";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const LIVE_GENERATOR = "scripts/assert-m004-s05-live-pages.mjs";

export class LivePageAssertionFailure extends Error {
  constructor(phase, message, diagnostics = {}) {
    super(`[assert-m004-s05-live-pages] Phase ${phase}: ${message}`);
    this.name = "LivePageAssertionFailure";
    this.phase = phase;
    this.diagnostics = diagnostics;
  }
}

export function phaseFail(phase, message, diagnostics = {}) {
  return new LivePageAssertionFailure(phase, message, diagnostics);
}

export const REPRESENTATIVE_ROUTE_CONTRACTS = [
  {
    route: "/races/state-assembly-district-17/",
    slug: "state-assembly-district-17",
    title: "State Assembly District 17",
    requiredText: ["State Assembly District 17", "Source-by-candidate comparison", "California Secretary of State", "GrowSF"],
    requiredMarkers: [
      { name: "race slug", text: 'data-race-slug="state-assembly-district-17"' },
      { name: "multi-source matrix source count", pattern: /data-matrix-source-count="[2-9][0-9]*"/ },
      { name: "non-empty matrix cell count", pattern: /data-matrix-cell-count="[1-9][0-9]*"/ },
      { name: "desktop matrix", text: 'data-matrix-view="desktop"' },
      { name: "mobile matrix", text: 'data-matrix-view="mobile"' },
      { name: "Secretary of State source", text: 'data-source-id="src-ca-secretary-of-state"' },
      { name: "GrowSF source", text: 'data-source-id="src-growsf"' },
      { name: "Matt Haney candidate", text: 'data-candidate-id="ent-state-assembly-district-17-matt-haney"' },
      { name: "informational matrix cell", text: 'data-position-kind="informational"' },
      { name: "endorsement matrix cell", text: 'data-position-kind="endorse"' },
      { name: "receipt diagnostics", pattern: /data-receipt-(?:count|available-count|status)="[^"]+"/ },
      { name: "available receipt", text: 'data-receipt-status="available"' },
    ],
  },
  {
    route: "/races/california-governor/",
    slug: "california-governor",
    title: "California Governor",
    requiredText: ["California Governor", "Source-by-candidate comparison", "California Secretary of State", "San Francisco Chronicle"],
    requiredMarkers: [
      { name: "race slug", text: 'data-race-slug="california-governor"' },
      { name: "multi-source matrix source count", pattern: /data-matrix-source-count="[2-9][0-9]*"/ },
      { name: "non-empty matrix cell count", pattern: /data-matrix-cell-count="[1-9][0-9]*"/ },
      { name: "desktop matrix", text: 'data-matrix-view="desktop"' },
      { name: "mobile matrix", text: 'data-matrix-view="mobile"' },
      { name: "Secretary of State source", text: 'data-source-id="src-ca-secretary-of-state"' },
      { name: "Chronicle source", text: 'data-source-id="src-sf-chronicle"' },
      { name: "GrowSF empty-source marker", text: 'data-source-id="src-growsf"' },
      { name: "Katie Porter candidate", text: 'data-candidate-id="ent-california-governor-katie-porter"' },
      { name: "Matt Mahan hidden-claim candidate", text: 'data-candidate-id="ent-california-governor-matt-mahan"' },
      { name: "endorsement matrix cell", text: 'data-position-kind="endorse"' },
      { name: "no-public-position matrix cell", text: 'data-position-kind="no-public-position"' },
      { name: "receipt diagnostics", pattern: /data-receipt-(?:count|available-count|status)="[^"]+"/ },
      { name: "no-public-position receipt", text: 'data-receipt-empty-reason="no-public-position"' },
    ],
  },
  {
    route: "/races/us-house-district-11/",
    slug: "us-house-district-11",
    title: "U.S. House District 11",
    requiredText: ["U.S. House District 11", "Source-by-candidate comparison", "GrowSF", "Scott Wiener"],
    requiredMarkers: [
      { name: "race slug", text: 'data-race-slug="us-house-district-11"' },
      { name: "multi-source matrix source count", pattern: /data-matrix-source-count="[2-9][0-9]*"/ },
      { name: "non-empty matrix cell count", pattern: /data-matrix-cell-count="[1-9][0-9]*"/ },
      { name: "desktop matrix", text: 'data-matrix-view="desktop"' },
      { name: "mobile matrix", text: 'data-matrix-view="mobile"' },
      { name: "GrowSF source", text: 'data-source-id="src-growsf"' },
      { name: "Scott Wiener candidate", text: 'data-candidate-id="ent-us-house-district-11-scott-wiener"' },
      { name: "endorsement matrix cell", text: 'data-position-kind="endorse"' },
      { name: "receipt diagnostics", pattern: /data-receipt-(?:count|available-count|status)="[^"]+"/ },
      { name: "available receipt", text: 'data-receipt-status="available"' },
      { name: "Scott Wiener evidence copy", pattern: /Scott Wiener[\s\S]{0,1200}(?:1|[2-9][0-9]*) evidence|(?:1|[2-9][0-9]*) evidence[\s\S]{0,1200}Scott Wiener/i },
    ],
  },
];

export const FORBIDDEN_LEAKAGE_PATTERNS = [
  { id: "sample-candidate", description: "sample candidate leakage", pattern: /Sample Candidate/i },
  { id: "sample-voter-guide", description: "sample voter-guide URL leakage", pattern: /sample-voter-guide/i },
  { id: "stale-mayor-fixture", description: "stale Mayor fixture leakage", pattern: /(?:^|[\s/"'])mayor(?:[\s/"']|$)/i },
  { id: "debug-route", description: "debug route link leakage", pattern: /\/debug\//i },
  { id: "visible-diagnostics", description: "public diagnostic heading", pattern: /Visible diagnostics/i },
  { id: "checked-public-data-files", description: "checked-file disclosure heading", pattern: /Checked public data files/i },
  { id: "manual-review-path", description: "private manual review path", pattern: /manual\/(?:reviews|overrides)\//i },
  { id: "private-data-path", description: "private data path", pattern: /data\/(?:public|extracted|ingested|reviewed)\//i },
  { id: "gsd-path", description: "private GSD path", pattern: /\.gsd\//i },
  { id: "local-absolute-path", description: "absolute local path", pattern: /\/home\//i },
  { id: "file-url", description: "file URL path", pattern: /file:\/\//i },
];

export function normalizeOrigin(rawOrigin = DEFAULT_ORIGIN) {
  if (!rawOrigin || typeof rawOrigin !== "string") throw phaseFail("origin", "--origin must be a non-empty http(s) URL.");
  let url;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw phaseFail("origin", `invalid --origin URL: ${JSON.stringify(rawOrigin)}.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw phaseFail("origin", `--origin must use http or https: ${JSON.stringify(rawOrigin)}.`);
  url.hash = "";
  url.search = "";
  const pathname = url.pathname.replace(/\/+$/, "");
  const basePath = pathname === "" || pathname === "/" ? "" : pathname;
  return { displayOrigin: `${url.origin}${basePath}`, origin: url.origin, basePath };
}

export function buildRouteUrl(originInfo, route) {
  const normalizedRoute = `/${String(route).replace(/^\/+/, "")}`;
  const basePath = originInfo.basePath ? `/${originInfo.basePath.replace(/^\/+|\/+$/g, "")}` : "";
  return new URL(`${basePath}${normalizedRoute}`, originInfo.origin).href;
}

export function validateJsonOutPath(relativePath, projectRoot = process.cwd()) {
  if (!relativePath || path.isAbsolute(relativePath)) throw phaseFail("json-out", `json-out path must be a project-relative path under data/launch: ${JSON.stringify(relativePath)}.`);
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized.startsWith("data/launch/") || !normalized.endsWith(".json")) throw phaseFail("json-out", `json-out path must be a .json file under data/launch/: ${JSON.stringify(relativePath)}.`);
  const fullPath = resolve(projectRoot, relativePath);
  const launchDir = resolve(projectRoot, "data/launch");
  if (fullPath === launchDir || !fullPath.startsWith(`${launchDir}${sep}`)) throw phaseFail("json-out", `json-out path escapes data/launch/: ${JSON.stringify(relativePath)}.`);
  return fullPath;
}

export function parseCliArgs(argv = process.argv.slice(2), projectRoot = process.cwd()) {
  const options = { origin: DEFAULT_ORIGIN, jsonOut: null, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--origin") {
      const value = argv[index + 1];
      if (!value) throw phaseFail("origin", "--origin requires a URL value.");
      normalizeOrigin(value);
      options.origin = value;
      index += 1;
      continue;
    }
    if (arg === "--json-out") {
      const value = argv[index + 1];
      if (!value) throw phaseFail("json-out", "--json-out requires a path value.");
      validateJsonOutPath(value, projectRoot);
      options.jsonOut = value;
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = argv[index + 1];
      const timeoutMs = Number(value);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw phaseFail("timeout", `--timeout-ms must be an integer from 100 to 120000: ${JSON.stringify(value)}.`);
      options.timeoutMs = timeoutMs;
      index += 1;
      continue;
    }
    throw phaseFail("cli", `unknown argument ${JSON.stringify(arg)}.`);
  }
  return options;
}

export function assertRouteHtml(contract, html) {
  const markerAssertions = [];
  const missingMarkers = [];
  const addAssertion = (name, ok) => {
    markerAssertions.push({ name, status: ok ? "pass" : "fail" });
    if (!ok) missingMarkers.push(name);
  };

  for (const text of contract.requiredText ?? []) addAssertion(`text: ${text}`, html.includes(text));
  for (const marker of contract.requiredMarkers ?? []) {
    const ok = marker.text ? html.includes(marker.text) : marker.pattern.test(html);
    addAssertion(marker.name, ok);
  }

  const leakageFindings = [];
  for (const check of FORBIDDEN_LEAKAGE_PATTERNS) {
    if (check.pattern.test(html)) leakageFindings.push({ patternId: check.id, description: check.description });
  }

  return { markerAssertions, missingMarkers, leakageFindings };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
  } catch (error) {
    if (error?.name === "AbortError") throw phaseFail("timeout", `${url} timed out after ${timeoutMs}ms.`);
    throw phaseFail("fetch", `${url} failed to fetch: ${error instanceof Error ? error.message : String(error)}.`);
  } finally {
    clearTimeout(timer);
  }
}

export function validateLiveReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["report must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.milestone !== "M004") errors.push("milestone must be M004");
  if (report.slice !== "S05") errors.push("slice must be S05");
  if (report.generatedBy !== LIVE_GENERATOR) errors.push("generatedBy must identify the S05 live script");
  if (report.status !== "pass") errors.push("status must be pass");
  if (!/^https?:\/\//.test(report.origin ?? "")) errors.push("origin must be an http(s) origin");
  for (const field of ["startedAt", "completedAt"]) if (!report[field] || Number.isNaN(Date.parse(report[field]))) errors.push(`${field} must be an ISO timestamp`);
  if (!Array.isArray(report.checkedRoutes) || report.checkedRoutes.length !== REPRESENTATIVE_ROUTE_CONTRACTS.length) errors.push("checkedRoutes must include the three representative routes");
  for (const route of report.checkedRoutes ?? []) {
    if (!route.route || route.status !== 200 || !Number.isInteger(route.bytes) || route.bytes <= 0) errors.push(`checked route ${route.route ?? "<missing>"} must have 200 and positive bytes`);
    if (!Array.isArray(route.markerAssertions) || route.markerAssertions.some((marker) => marker.status !== "pass")) errors.push(`checked route ${route.route ?? "<missing>"} must have passing marker assertions`);
    if (!Array.isArray(route.leakageFindings) || route.leakageFindings.length > 0) errors.push(`checked route ${route.route ?? "<missing>"} must not have leakage findings`);
  }
  if (!report.phases || typeof report.phases !== "object") errors.push("phases object is required");
  for (const finding of findReportLeakage(report)) errors.push(`report leaked ${finding.patternId}`);
  return errors;
}

function findReportLeakage(value) {
  const findings = [];
  const reportPatterns = FORBIDDEN_LEAKAGE_PATTERNS.filter((pattern) => !["stale-mayor-fixture", "private-data-path"].includes(pattern.id));
  const visit = (item) => {
    if (typeof item === "string") {
      for (const check of reportPatterns) if (check.pattern.test(item)) findings.push({ patternId: check.id });
      return;
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) item.forEach(visit);
    else Object.values(item).forEach(visit);
  };
  visit(value);
  return findings;
}

export async function runLivePageAssertions({ origin = DEFAULT_ORIGIN, jsonOut = null, projectRoot = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw phaseFail("fetch", "fetch is not available in this Node.js runtime.");
  const originInfo = normalizeOrigin(origin);
  const startedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    milestone: "M004",
    slice: "S05",
    generatedBy: LIVE_GENERATOR,
    status: "fail",
    startedAt,
    origin: originInfo.displayOrigin,
    timeoutMs,
    checkedRoutes: [],
    counts: { checkedRoutes: 0, markerAssertions: 0, leakageFindings: 0 },
    phases: { origin: { status: "pass" }, fetch: { status: "pending" }, markers: { status: "pending" }, leakage: { status: "pending" }, report: { status: "pending" }, jsonOut: { status: jsonOut ? "pending" : "skipped" } },
  };

  for (const contract of REPRESENTATIVE_ROUTE_CONTRACTS) {
    const url = buildRouteUrl(originInfo, contract.route);
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    const html = new TextDecoder().decode(arrayBuffer);
    const contentType = response.headers?.get?.("content-type") ?? "";
    const assertions = response.status === 200 ? assertRouteHtml(contract, html) : { markerAssertions: [], missingMarkers: [], leakageFindings: [] };
    const routeSummary = {
      route: contract.route,
      slug: contract.slug,
      url,
      status: response.status,
      contentType,
      bytes,
      markerAssertions: assertions.markerAssertions,
      missingMarkers: assertions.missingMarkers,
      leakageFindings: assertions.leakageFindings,
    };
    report.checkedRoutes.push(routeSummary);

    if (response.status !== 200) throw phaseFail("non-200", `${contract.route} returned ${response.status}.`, report);
    if (assertions.missingMarkers.length > 0) throw phaseFail("marker", `${contract.route} is missing required markers: ${assertions.missingMarkers.join(", ")}.`, report);
    if (assertions.leakageFindings.length > 0) throw phaseFail("leakage", `${contract.route} leaked forbidden public content patterns: ${assertions.leakageFindings.map((finding) => finding.patternId).join(", ")}.`, report);
  }

  report.status = "pass";
  report.completedAt = new Date().toISOString();
  report.counts = {
    checkedRoutes: report.checkedRoutes.length,
    markerAssertions: report.checkedRoutes.reduce((sum, route) => sum + route.markerAssertions.length, 0),
    leakageFindings: report.checkedRoutes.reduce((sum, route) => sum + route.leakageFindings.length, 0),
  };
  report.phases.fetch = { status: "pass", checked: report.checkedRoutes.length };
  report.phases.markers = { status: "pass", checked: report.counts.markerAssertions };
  report.phases.leakage = { status: "pass", checked: FORBIDDEN_LEAKAGE_PATTERNS.length * report.checkedRoutes.length };

  const validationErrors = validateLiveReport(report);
  if (validationErrors.length > 0) throw phaseFail("report", validationErrors.join("; "), report);
  report.phases.report = { status: "pass" };

  if (jsonOut) {
    const outputPath = validateJsonOutPath(jsonOut, projectRoot);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    report.phases.jsonOut = { status: "pass", path: path.relative(projectRoot, outputPath).replaceAll(path.sep, "/") };
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return report;
}

async function main() {
  try {
    const options = parseCliArgs();
    const report = await runLivePageAssertions(options);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const payload = {
      ok: false,
      phase: error?.phase ?? "unknown",
      message: error instanceof Error ? error.message : String(error),
      diagnostics: error?.diagnostics ?? undefined,
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
