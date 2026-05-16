#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPRESENTATIVE_ROUTE_CONTRACTS, validateLiveReport } from "./assert-m004-s05-live-pages.mjs";

export const LIVE_REPORT_PATH = "data/launch/m004-s05-live-pages.json";
export const LAUNCH_REPORT_PATH = "data/launch/m004-s05-launch-verification.json";
export const LATEST_REPORT_PATH = "data/launch/latest.json";
export const RECORDER_GENERATOR = "scripts/record-m004-s05-launch-verification.mjs";

export const PRIVATE_REPORT_PATTERNS = [
  { id: "gsd-path", description: "private GSD path", pattern: /(?:^|[\s"'>(/])\.gsd(?:\/|[\s"'<)]|$)/i },
  { id: "absolute-local-path", description: "absolute local path", pattern: /\/home\//i },
  { id: "file-url", description: "file URL path", pattern: /file:\/\//i },
  { id: "manual-review-path", description: "private manual review path", pattern: /manual\/(?:reviews|overrides)\//i },
  { id: "secret-like-token", description: "secret-like token", pattern: /(?:api[_-]?key|secret|token|password)["'=:\s]+[A-Za-z0-9_./~+-]{8,}/i },
];

export function findPrivateReportLeakage(value) {
  const findings = [];
  const visit = (item, key = "") => {
    if (typeof item === "string") {
      for (const check of PRIVATE_REPORT_PATTERNS) {
        const match = check.pattern.exec(item);
        if (match) findings.push({ key, patternId: check.id, description: check.description, match: match[0] });
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

export function createM004S05LaunchVerificationReport({ liveReport, now = new Date() }) {
  const liveErrors = validateLiveReport(liveReport);
  const expectedRoutes = REPRESENTATIVE_ROUTE_CONTRACTS.map((contract) => contract.route);
  const actualRoutes = new Set((liveReport?.checkedRoutes ?? []).map((route) => route.route));
  const missingRoutes = expectedRoutes.filter((route) => !actualRoutes.has(route));
  const redactionFindings = findPrivateReportLeakage(liveReport);
  const gates = {
    livePages: { status: liveErrors.length === 0 ? "pass" : "fail", errors: liveErrors },
    routeCoverage: { status: missingRoutes.length === 0 ? "pass" : "fail", errors: missingRoutes.map((route) => `missing representative route ${route}`) },
    redaction: { status: redactionFindings.length === 0 ? "pass" : "fail", errors: redactionFindings.map((finding) => `${finding.description}: ${finding.match}`) },
  };
  const status = Object.values(gates).every((gate) => gate.status === "pass") ? "pass" : "fail";

  return {
    schemaVersion: 1,
    milestone: "M004",
    slice: "S05",
    generatedBy: RECORDER_GENERATOR,
    generatedAt: now.toISOString(),
    status,
    origin: liveReport?.origin ?? null,
    artifacts: {
      livePages: LIVE_REPORT_PATH,
      launchVerification: LAUNCH_REPORT_PATH,
      latest: LATEST_REPORT_PATH,
    },
    summaries: {
      routes: {
        expectedRoutes: expectedRoutes.length,
        checkedRoutes: Array.isArray(liveReport?.checkedRoutes) ? liveReport.checkedRoutes.length : 0,
        missingRoutes,
      },
      counts: {
        markerAssertions: liveReport?.counts?.markerAssertions ?? 0,
        leakageFindings: liveReport?.counts?.leakageFindings ?? 0,
        bytes: Array.isArray(liveReport?.checkedRoutes) ? liveReport.checkedRoutes.reduce((sum, route) => sum + (Number(route.bytes) || 0), 0) : 0,
      },
      phases: liveReport?.phases ?? {},
    },
    checkedRoutes: Array.isArray(liveReport?.checkedRoutes)
      ? liveReport.checkedRoutes.map((route) => ({ route: route.route, status: route.status, bytes: route.bytes, markerAssertions: route.markerAssertions?.length ?? 0, leakageFindings: route.leakageFindings?.length ?? 0 }))
      : [],
    redaction: {
      status: redactionFindings.length === 0 ? "pass" : "fail",
      checkedArtifacts: [LIVE_REPORT_PATH],
      forbiddenClasses: ["private workspace paths", "file URLs", "secret-like tokens", "manual review paths"],
    },
    gates,
  };
}

export function validateM004S05LaunchVerificationReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["launch verification report must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.milestone !== "M004") errors.push("milestone must be M004");
  if (report.slice !== "S05") errors.push("slice must be S05");
  if (report.generatedBy !== RECORDER_GENERATOR) errors.push("generatedBy must identify the M004/S05 launch verification recorder");
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (report.status !== "pass") errors.push("status must be pass");
  if (!/^https?:\/\//.test(report.origin ?? "")) errors.push("origin must be an http(s) origin");
  for (const key of ["livePages", "routeCoverage", "redaction"]) if (report.gates?.[key]?.status !== "pass") errors.push(`gate ${key} must pass`);
  for (const key of ["livePages", "launchVerification", "latest"]) if (!report.artifacts?.[key] || typeof report.artifacts[key] !== "string") errors.push(`artifacts.${key} is required`);
  if (report.summaries?.routes?.expectedRoutes !== REPRESENTATIVE_ROUTE_CONTRACTS.length) errors.push(`summaries.routes.expectedRoutes must be ${REPRESENTATIVE_ROUTE_CONTRACTS.length}`);
  if (report.summaries?.routes?.checkedRoutes !== REPRESENTATIVE_ROUTE_CONTRACTS.length) errors.push(`summaries.routes.checkedRoutes must be ${REPRESENTATIVE_ROUTE_CONTRACTS.length}`);
  if (!Array.isArray(report.summaries?.routes?.missingRoutes) || report.summaries.routes.missingRoutes.length !== 0) errors.push("summaries.routes.missingRoutes must be empty");
  if (!Number.isInteger(report.summaries?.counts?.markerAssertions) || report.summaries.counts.markerAssertions <= 0) errors.push("summaries.counts.markerAssertions must be positive");
  if (report.summaries?.counts?.leakageFindings !== 0) errors.push("summaries.counts.leakageFindings must be 0");
  if (report.redaction?.status !== "pass") errors.push("redaction.status must be pass");
  for (const finding of findPrivateReportLeakage(report)) errors.push(`launch verification report leaked ${finding.description}: ${finding.match}`);
  return errors;
}

export function readJson(relativePath, projectRoot = process.cwd()) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

export function writeJson(relativePath, value, projectRoot = process.cwd()) {
  const fullPath = path.join(projectRoot, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { liveReportPath: LIVE_REPORT_PATH, reportOut: LAUNCH_REPORT_PATH, latestOut: LATEST_REPORT_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (["--live-report", "--live-json", "--json-out", "--latest-out"].includes(arg) && !value) throw new Error(`${arg} requires a path value`);
    if (arg === "--live-report" || arg === "--live-json") options.liveReportPath = value;
    else if (arg === "--json-out") options.reportOut = value;
    else if (arg === "--latest-out") options.latestOut = value;
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    index += 1;
  }
  return options;
}

function requireJson(relativePath, projectRoot) {
  if (!existsSync(path.join(projectRoot, relativePath))) throw new Error(`Phase live-report: missing artifact ${relativePath}`);
  return readJson(relativePath, projectRoot);
}

export function recordM004S05LaunchVerification({ liveReportPath = LIVE_REPORT_PATH, reportOut = LAUNCH_REPORT_PATH, latestOut = LATEST_REPORT_PATH, projectRoot = process.cwd(), now = new Date() } = {}) {
  const liveReport = requireJson(liveReportPath, projectRoot);
  const liveErrors = validateLiveReport(liveReport);
  if (liveErrors.length > 0) throw new Error(`Phase live-report-validation: ${liveErrors.join("; ")}`);
  const report = createM004S05LaunchVerificationReport({ liveReport, now });
  const reportErrors = validateM004S05LaunchVerificationReport(report);
  if (reportErrors.length > 0) throw new Error(`Phase final-launch-report: ${reportErrors.join("; ")}`);
  writeJson(reportOut, report, projectRoot);
  writeJson(latestOut, report, projectRoot);
  return report;
}

function main() {
  try {
    const options = parseArgs();
    const report = recordM004S05LaunchVerification(options);
    console.log(`M004/S05 launch verification recorded: ${report.summaries.routes.checkedRoutes} live routes, ${report.summaries.counts.markerAssertions} marker assertions, ${report.summaries.counts.bytes} bytes, status=${report.status}.`);
  } catch (error) {
    console.error(`[record-m004-s05-launch-verification] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
