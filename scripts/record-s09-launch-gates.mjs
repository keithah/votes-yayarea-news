#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const LAUNCH_GATE_PATH = "data/launch/latest.json";

export const ROUTE_SPECS = [
  { route: "/", path: "out/index.html", title: "votes.yayarea.news · San Francisco election guide", canonical: "https://votes.yayarea.news/" },
  { route: "/races/california-governor/", path: "out/races/california-governor/index.html", title: "California Governor source records", canonical: "https://votes.yayarea.news/races/california-governor/" },
  { route: "/how-we-use-ai/", path: "out/how-we-use-ai/index.html", title: "How we use AI", canonical: "https://votes.yayarea.news/how-we-use-ai/" },
  { route: "/entities/california-governor-akinyemi-agbede/", path: "out/entities/california-governor-akinyemi-agbede/index.html", title: "Akinyemi Agbede public source trail", canonical: "https://votes.yayarea.news/entities/california-governor-akinyemi-agbede/" },
  { route: "/sources/california-secretary-of-state/", path: "out/sources/california-secretary-of-state/index.html", title: "California Secretary of State public source trail", canonical: "https://votes.yayarea.news/sources/california-secretary-of-state/" },
];

export const REQUIRED_ANALYTICS_EVENTS = ["race_page_view", "recommendation_matrix_open", "receipt_drawer_open"];
export const PRIVATE_TRUST_PATTERNS = [
  { id: "gsd_path", pattern: /\.gsd(?:\/|\b)/i, description: "No .gsd planning paths in public export." },
  { id: "manual_reviews", pattern: /manual\/reviews\//i, description: "No manual review staging paths in public export." },
  { id: "extraction_drafts", pattern: /data\/extracted\/drafts\//i, description: "No hidden extraction draft paths in public export." },
  { id: "absolute_local_path", pattern: /\/home\/[^\s"'<>]+/i, description: "No machine-local absolute paths in public export." },
  { id: "file_url", pattern: /file:\/\//i, description: "No local file URLs in public export." },
  { id: "endorsement_language", pattern: /\b(?:vote\s+for|must\s+support|we\s+recommend|our\s+pick|best\s+choice)\b/i, description: "No product-authored directive endorsement language in public export." },
];

function readHtmlByRoute() {
  return Object.fromEntries(
    ROUTE_SPECS.map((spec) => [spec.route, existsSync(spec.path) ? readFileSync(spec.path, "utf8") : null]),
  );
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCanonical(html, canonical) {
  return new RegExp(`<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']${escaped(canonical)}[\"']`, "i").test(html);
}

function summarizeRoutes(htmlByRoute) {
  return ROUTE_SPECS.map((spec) => {
    const html = htmlByRoute[spec.route];
    const exists = typeof html === "string";
    return {
      route: spec.route,
      exportPath: spec.path,
      status: exists ? "pass" : "fail",
      htmlBytes: exists ? html.length : 0,
      hasTitle: exists ? html.includes(`<title>${spec.title}</title>`) : false,
      hasCanonical: exists ? hasCanonical(html, spec.canonical) : false,
    };
  });
}

function summarizeMetadataShare(routeChecks, htmlByRoute) {
  const routeStatuses = routeChecks.map((check) => ({
    route: check.route,
    status: check.status === "pass" && check.hasTitle && check.hasCanonical && /og:image/i.test(htmlByRoute[check.route] ?? "") && /twitter:image/i.test(htmlByRoute[check.route] ?? "") ? "pass" : "fail",
    title: check.hasTitle ? "pass" : "fail",
    canonical: check.hasCanonical ? "pass" : "fail",
    openGraphImage: /og:image/i.test(htmlByRoute[check.route] ?? "") ? "pass" : "fail",
    twitterImage: /twitter:image/i.test(htmlByRoute[check.route] ?? "") ? "pass" : "fail",
  }));
  return { status: routeStatuses.every((route) => route.status === "pass") ? "pass" : "fail", routes: routeStatuses };
}

function summarizeAnalytics(htmlByRoute) {
  const combined = Object.values(htmlByRoute).filter((value) => typeof value === "string").join("\n");
  const events = REQUIRED_ANALYTICS_EVENTS.map((eventName) => ({
    eventName,
    markerCount: (combined.match(new RegExp(`data-analytics-event=[\"']${eventName}[\"']`, "g")) ?? []).length,
  })).map((event) => ({ ...event, status: event.markerCount > 0 ? "pass" : "fail" }));
  return { status: events.every((event) => event.status === "pass") ? "pass" : "fail", events };
}

function summarizeTrustLeaks(htmlByRoute) {
  const combined = Object.values(htmlByRoute).filter((value) => typeof value === "string").join("\n");
  const checks = PRIVATE_TRUST_PATTERNS.map(({ id, pattern, description }) => ({
    id,
    description,
    status: pattern.test(combined) ? "fail" : "pass",
  }));
  return { status: checks.every((check) => check.status === "pass") ? "pass" : "fail", checks };
}

function summarizeStaticSmoke(smokeReport) {
  if (!smokeReport) return { status: "pending", note: "Run scripts/smoke-s09-static-export.mjs through pnpm verify:s09 to populate this gate." };
  return {
    status: smokeReport.ok === true ? "pass" : "fail",
    checkedRoutes: Array.isArray(smokeReport.checkedRoutes) ? smokeReport.checkedRoutes.map((route) => ({ route: route.route, status: route.status, contentType: route.contentType })) : [],
    trailingSlashChecks: Array.isArray(smokeReport.trailingSlashChecks) ? smokeReport.trailingSlashChecks.map((route) => ({ route: route.route, status: route.status, location: route.location })) : [],
  };
}

export function createLaunchGateReport({ now = new Date(), htmlByRoute = readHtmlByRoute(), smokeReport = null, manualNotes = null } = {}) {
  const routeChecks = summarizeRoutes(htmlByRoute);
  const metadataShareStatus = summarizeMetadataShare(routeChecks, htmlByRoute);
  const analyticsEventCoverage = summarizeAnalytics(htmlByRoute);
  const publicTrustLeakChecks = summarizeTrustLeaks(htmlByRoute);
  const staticSmoke = summarizeStaticSmoke(smokeReport);
  const manualLighthouseBrowserNotes = manualNotes ?? {
    status: "pending",
    lighthouse: "Pending manual/browser Lighthouse run against the production-like static deploy.",
    browser: "Pending final browser spot-check for share-card previews and representative navigation.",
  };

  const gates = {
    routes: { status: routeChecks.every((route) => route.status === "pass") ? "pass" : "fail", checked: routeChecks },
    metadataShareStatus,
    analyticsEventCoverage,
    publicTrustLeakChecks,
    staticSmoke,
    manualLighthouseBrowserNotes,
  };

  const blockingStatuses = [gates.routes.status, metadataShareStatus.status, analyticsEventCoverage.status, publicTrustLeakChecks.status, staticSmoke.status];
  const overallStatus = blockingStatuses.every((status) => status === "pass") ? "pass" : "fail";

  return {
    schemaVersion: 1,
    slice: "S09",
    generatedBy: "scripts/record-s09-launch-gates.mjs",
    buildTimestamp: now.toISOString(),
    overallStatus,
    checkedRoutes: ROUTE_SPECS.map(({ route, path }) => ({ route, exportPath: path })),
    gates,
  };
}

export function assertLaunchGateReport(report) {
  const issues = [];
  if (!report || typeof report !== "object") issues.push("Report must be an object.");
  if (report?.schemaVersion !== 1) issues.push("schemaVersion must be 1.");
  if (report?.slice !== "S09") issues.push("slice must be S09.");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(report?.buildTimestamp ?? ""))) issues.push("buildTimestamp must be an ISO timestamp.");
  if (!Array.isArray(report?.checkedRoutes) || report.checkedRoutes.length < 5) issues.push("checkedRoutes must list representative S09 routes.");
  for (const key of ["routes", "metadataShareStatus", "analyticsEventCoverage", "publicTrustLeakChecks", "staticSmoke", "manualLighthouseBrowserNotes"]) {
    if (!report?.gates?.[key]) issues.push(`Missing gate ${key}.`);
  }
  const serialized = JSON.stringify(report);
  if (/\/home\/|file:\/\/|\.gsd\//i.test(serialized)) issues.push("Report must not include local absolute paths, file URLs, or .gsd paths.");
  return issues;
}

function parseSmokeReportArg() {
  const index = process.argv.indexOf("--smoke-json");
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value) throw new Error("--smoke-json requires a JSON string argument.");
  return JSON.parse(value);
}

function main() {
  const smokeReport = parseSmokeReportArg();
  const report = createLaunchGateReport({ smokeReport });
  const issues = assertLaunchGateReport(report);
  if (issues.length > 0) {
    console.error(`[record-s09-launch-gates] Phase launch-gate-json: ${issues.join(" ")}`);
    process.exit(1);
  }

  mkdirSync(dirname(LAUNCH_GATE_PATH), { recursive: true });
  writeFileSync(LAUNCH_GATE_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (report.overallStatus !== "pass") {
    console.error(`[record-s09-launch-gates] Phase launch-gate-status: wrote ${LAUNCH_GATE_PATH}, but blocking launch gates are ${report.overallStatus}.`);
    console.error(JSON.stringify(report.gates, null, 2));
    process.exit(1);
  }

  console.log(`S09 launch gates recorded at ${LAUNCH_GATE_PATH} with overallStatus=${report.overallStatus}. Manual Lighthouse/browser notes remain ${report.gates.manualLighthouseBrowserNotes.status}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
