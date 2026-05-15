#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateS05LaunchReport } from "./assert-s05-launch-export.mjs";
import { validateS05StaticSmokeReport } from "./smoke-s05-static-export.mjs";

export const BROWSER_CHECKS_PATH = "data/launch/s05-browser-checks.json";
export const STATIC_SMOKE_PATH = "data/launch/s05-static-smoke.json";
export const LAUNCH_EXPORT_PATH = "data/launch/s05-launch-export.json";
export const FINAL_REPORT_PATH = "data/launch/s05-launch-verification.json";
export const RECORDER_GENERATOR = "scripts/record-s05-launch-verification.mjs";

export const REQUIRED_BROWSER_ROUTE_CLASSES = ["homepage", "race", "source", "entity", "disclosure"];
export const REQUIRED_BROWSER_ROUTES = ["/", "/races/california-governor/", "/how-we-use-ai/"];
export const PRIVATE_REPORT_PATTERNS = [
  { description: "private GSD path", pattern: /\.gsd(?:\/|\b)/i },
  { description: "absolute local path", pattern: /\/home\//i },
  { description: "file URL path", pattern: /file:\/\//i },
  { description: "private manual review path", pattern: /manual\/(?:reviews|overrides)\//i },
  { description: "secret-like token", pattern: /(?:api[_-]?key|secret|token|password)["'=:\s]+[A-Za-z0-9_./~+-]{8,}/i },
];

export function validateS05BrowserEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== "object") return ["browser evidence must be an object"];
  if (evidence.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (evidence.slice !== "S05") errors.push("slice must be S05");
  if (!evidence.generatedBy || typeof evidence.generatedBy !== "string") errors.push("generatedBy must identify the browser evidence recorder");
  if (!evidence.checkedAt || Number.isNaN(Date.parse(evidence.checkedAt))) errors.push("checkedAt must be an ISO timestamp");
  if (!evidence.origin || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(evidence.origin)) errors.push("origin must be a local HTTP origin");
  if (!Array.isArray(evidence.devices) || evidence.devices.length === 0) errors.push("devices must be a non-empty array");

  const deviceKinds = new Set();
  for (const [deviceIndex, device] of (evidence.devices ?? []).entries()) {
    const label = device?.name ?? `devices[${deviceIndex}]`;
    if (!device || typeof device !== "object") {
      errors.push(`device ${deviceIndex} must be an object`);
      continue;
    }
    if (!device.name || typeof device.name !== "string") errors.push(`device ${label} must include name`);
    if (!device.kind || !["desktop", "mobile"].includes(device.kind)) errors.push(`device ${label} kind must be desktop or mobile`);
    else deviceKinds.add(device.kind);
    if (!device.viewport || !Number.isInteger(device.viewport.width) || !Number.isInteger(device.viewport.height) || device.viewport.width <= 0 || device.viewport.height <= 0) {
      errors.push(`device ${label} viewport must include positive integer width and height`);
    }
    if (!Array.isArray(device.consoleErrors)) errors.push(`device ${label} consoleErrors must be an array`);
    else if (device.consoleErrors.length > 0) errors.push(`device ${label} consoleErrors must be empty`);
    if (!Array.isArray(device.routes) || device.routes.length === 0) {
      errors.push(`device ${label} routes must be a non-empty array`);
      continue;
    }

    const routeSet = new Set();
    const classSet = new Set();
    for (const [routeIndex, route] of device.routes.entries()) {
      const routeLabel = route?.route ?? `routes[${routeIndex}]`;
      if (!route || typeof route !== "object") {
        errors.push(`device ${label} route ${routeIndex} must be an object`);
        continue;
      }
      if (!route.route || typeof route.route !== "string" || !route.route.startsWith("/")) errors.push(`device ${label} route ${routeLabel} must include a root-relative route`);
      else routeSet.add(route.route);
      if (!route.className || typeof route.className !== "string") errors.push(`device ${label} route ${routeLabel} must include className`);
      else classSet.add(route.className);
      if (!route.url || typeof route.url !== "string" || !route.url.startsWith(evidence.origin)) errors.push(`device ${label} route ${routeLabel} url must start with origin`);
      if (!Number.isInteger(route.status) || route.status !== 200) errors.push(`device ${label} route ${routeLabel} status must be 200`);
      if (!Array.isArray(route.assertions) || route.assertions.length === 0) {
        errors.push(`device ${label} route ${routeLabel} assertions must be a non-empty array`);
        continue;
      }
      for (const [assertionIndex, assertion] of route.assertions.entries()) {
        const assertionLabel = assertion?.name ?? `assertions[${assertionIndex}]`;
        if (!assertion?.name || typeof assertion.name !== "string") errors.push(`device ${label} route ${routeLabel} assertion ${assertionIndex} must include name`);
        if (assertion?.status !== "pass") errors.push(`device ${label} route ${routeLabel} assertion ${assertionLabel} must pass`);
      }
    }

    for (const requiredRoute of REQUIRED_BROWSER_ROUTES) {
      if (!routeSet.has(requiredRoute)) errors.push(`device ${label} missing required route ${requiredRoute}`);
    }
    for (const requiredClass of REQUIRED_BROWSER_ROUTE_CLASSES) {
      if (!classSet.has(requiredClass)) errors.push(`device ${label} missing required route class ${requiredClass}`);
    }
  }

  for (const kind of ["desktop", "mobile"]) {
    if (!deviceKinds.has(kind)) errors.push(`devices must include a ${kind} entry`);
  }

  for (const finding of findPrivateReportLeakage(evidence)) errors.push(`browser evidence leaked ${finding.description}: ${finding.match}`);
  return errors;
}

export function createS05LaunchVerificationReport({ now = new Date(), staticSmoke, browserEvidence, launchExport }) {
  const staticSmokeErrors = validateS05StaticSmokeReport(staticSmoke);
  const browserErrors = validateS05BrowserEvidence(browserEvidence);
  const launchExportErrors = validateS05LaunchReport(launchExport);
  const gates = {
    staticSmoke: { status: staticSmokeErrors.length === 0 ? "pass" : "fail", errors: staticSmokeErrors },
    browserEvidence: { status: browserErrors.length === 0 ? "pass" : "fail", errors: browserErrors },
    routeLinkLeakage: { status: launchExportErrors.length === 0 ? "pass" : "fail", errors: launchExportErrors },
  };
  const status = Object.values(gates).every((gate) => gate.status === "pass") ? "pass" : "fail";
  return {
    schemaVersion: 1,
    slice: "S05",
    generatedBy: RECORDER_GENERATOR,
    generatedAt: now.toISOString(),
    status,
    artifacts: {
      staticSmoke: STATIC_SMOKE_PATH,
      browserEvidence: BROWSER_CHECKS_PATH,
      routeLinkLeakage: LAUNCH_EXPORT_PATH,
    },
    counts: {
      browserDevices: Array.isArray(browserEvidence?.devices) ? browserEvidence.devices.length : 0,
      browserRoutes: Array.isArray(browserEvidence?.devices) ? browserEvidence.devices.reduce((count, device) => count + (Array.isArray(device.routes) ? device.routes.length : 0), 0) : 0,
      staticSmokeRoutes: Array.isArray(staticSmoke?.checkedRoutes) ? staticSmoke.checkedRoutes.length : 0,
      exportRoutes: Array.isArray(launchExport?.checkedRoutes) ? launchExport.checkedRoutes.length : 0,
      exportLinksChecked: Number.isInteger(launchExport?.counts?.linksChecked) ? launchExport.counts.linksChecked : 0,
    },
    gates,
  };
}

export function validateS05LaunchVerificationReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["launch verification report must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.slice !== "S05") errors.push("slice must be S05");
  if (report.generatedBy !== RECORDER_GENERATOR) errors.push("generatedBy must identify the S05 launch verification recorder");
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (report.status !== "pass") errors.push("status must be pass");
  for (const key of ["staticSmoke", "browserEvidence", "routeLinkLeakage"]) {
    if (report.gates?.[key]?.status !== "pass") errors.push(`gate ${key} must pass`);
    if (!report.artifacts?.[key] || typeof report.artifacts[key] !== "string") errors.push(`artifacts.${key} is required`);
  }
  if (!Number.isInteger(report.counts?.browserDevices) || report.counts.browserDevices < 2) errors.push("counts.browserDevices must be at least 2");
  if (!Number.isInteger(report.counts?.browserRoutes) || report.counts.browserRoutes < 10) errors.push("counts.browserRoutes must be at least 10");
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

function findPrivateReportLeakage(value) {
  const findings = [];
  const visit = (item) => {
    if (typeof item === "string") {
      for (const check of PRIVATE_REPORT_PATTERNS) {
        const match = check.pattern.exec(item);
        if (match) findings.push({ description: check.description, match: match[0] });
      }
      return;
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) item.forEach(visit);
    else Object.values(item).forEach(visit);
  };
  visit(value);
  return findings;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    staticSmokePath: STATIC_SMOKE_PATH,
    browserEvidencePath: BROWSER_CHECKS_PATH,
    launchExportPath: LAUNCH_EXPORT_PATH,
    jsonOut: FINAL_REPORT_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (["--static-smoke-json", "--browser-json", "--launch-export-json", "--json-out"].includes(arg) && !value) throw new Error(`${arg} requires a path value`);
    if (arg === "--static-smoke-json") options.staticSmokePath = value;
    else if (arg === "--browser-json") options.browserEvidencePath = value;
    else if (arg === "--launch-export-json") options.launchExportPath = value;
    else if (arg === "--json-out") options.jsonOut = value;
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    index += 1;
  }
  return options;
}

function requireJson(relativePath, projectRoot) {
  if (!existsSync(path.join(projectRoot, relativePath))) throw new Error(`missing artifact ${relativePath}`);
  return readJson(relativePath, projectRoot);
}

function main() {
  try {
    const projectRoot = process.cwd();
    const options = parseArgs();
    const staticSmoke = requireJson(options.staticSmokePath, projectRoot);
    const browserEvidence = requireJson(options.browserEvidencePath, projectRoot);
    const launchExport = requireJson(options.launchExportPath, projectRoot);
    const report = createS05LaunchVerificationReport({ staticSmoke, browserEvidence, launchExport });
    const errors = validateS05LaunchVerificationReport(report);
    if (errors.length > 0) throw new Error(`Phase final-launch-report: ${errors.join("; ")}`);
    writeJson(options.jsonOut, report, projectRoot);
    console.log(`S05 launch verification recorded at ${options.jsonOut}: ${report.counts.browserDevices} devices, ${report.counts.browserRoutes} browser route checks, status=${report.status}.`);
  } catch (error) {
    console.error(`[record-s05-launch-verification] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
