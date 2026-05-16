#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateS07ExportReport } from "./assert-s07-export.mjs";
import { validateS07StaticSmokeReport } from "./smoke-s07-static-export.mjs";

export const STATIC_SMOKE_PATH = "data/launch/s07-static-smoke.json";
export const LAUNCH_EXPORT_PATH = "data/launch/s07-launch-export.json";
export const PAGES_WORKFLOW_PATH = ".github/workflows/pages.yml";
export const PAGES_PROOF_PATH = "data/launch/s07-pages-proof.json";
export const S07_REPORT_PATH = "data/launch/s07-launch-verification.json";
export const FINAL_REPORT_PATH = "data/launch/latest.json";
export const RECORDER_GENERATOR = "scripts/record-s07-launch-verification.mjs";

export const PRIVATE_REPORT_PATTERNS = [
  { description: "private GSD path", pattern: /(?:^|[\s"'>(/])\.gsd(?:\/|[\s"'<)]|$)/i },
  { description: "absolute local path", pattern: /\/home\//i },
  { description: "file URL path", pattern: /file:\/\//i },
  { description: "private manual review path", pattern: /manual\/(?:reviews|overrides)\//i },
  { description: "private debug route", pattern: /(?:^|[\s"'(<])\/debug(?:\/|["'?#\s<]|$)/i },
  { description: "private review route", pattern: /(?:^|[\s"'(<])\/review(?:\/|["'?#\s<]|$)/i },
  { description: "secret-like token", pattern: /(?:api[_-]?key|secret|token|password)["'=:\s]+[A-Za-z0-9_./~+-]{8,}/i },
];

export const WORKFLOW_CONTRACT_CHECKS = [
  {
    id: "node24",
    label: "Node 24 setup",
    test: (text) => /node-version:\s*["']?24["']?/i.test(text),
  },
  {
    id: "corepack",
    label: "Corepack enabled",
    test: (text) => /corepack\s+enable/i.test(text),
  },
  {
    id: "pnpmInstall",
    label: "Frozen pnpm install",
    test: (text) => /pnpm\s+install\s+--frozen-lockfile/i.test(text),
  },
  {
    id: "typecheck",
    label: "Typecheck phase",
    test: (text) => /pnpm\s+typecheck/i.test(text),
  },
  {
    id: "validateData",
    label: "Public data validation phase",
    test: (text) => /pnpm\s+validate-data/i.test(text),
  },
  {
    id: "build",
    label: "Static build phase",
    test: (text) => /pnpm\s+build/i.test(text),
  },
  {
    id: "githubPagesEnv",
    label: "GitHub Pages env enabled",
    test: (text) => /GITHUB_PAGES:\s*["']?true["']?/i.test(text),
  },
  {
    id: "siteOriginEnv",
    label: "Public site origin env set",
    test: (text) => /NEXT_PUBLIC_SITE_ORIGIN\s*:/i.test(text),
  },
  {
    id: "localOnlyRemoval",
    label: "Local-only route removal",
    test: (text) => /rm\s+-rf\s+out\/debug\s+out\/review/i.test(text) || /rm\s+-rf\s+out\/review\s+out\/debug/i.test(text),
  },
  {
    id: "nojekyll",
    label: "No-Jekyll marker",
    test: (text) => /touch\s+out\/\.nojekyll/i.test(text),
  },
  {
    id: "uploadOut",
    label: "Upload static export directory",
    test: (text) => /actions\/upload-pages-artifact@/i.test(text) && /path:\s*out\b/i.test(text),
  },
];

export function findPrivateReportLeakage(value) {
  const findings = [];
  const visit = (item, key = "") => {
    if (typeof item === "string") {
      for (const check of PRIVATE_REPORT_PATTERNS) {
        const match = check.pattern.exec(item);
        if (match) findings.push({ key, description: check.description, match: match[0] });
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

export function createS07PagesProofReport({ now = new Date(), workflowText, workflowPath = PAGES_WORKFLOW_PATH } = {}) {
  const checks = WORKFLOW_CONTRACT_CHECKS.map((check) => ({ id: check.id, label: check.label, status: check.test(workflowText ?? "") ? "pass" : "fail" }));
  const status = checks.every((check) => check.status === "pass") ? "pass" : "fail";
  return {
    schemaVersion: 1,
    slice: "S07",
    generatedBy: RECORDER_GENERATOR,
    generatedAt: now.toISOString(),
    status,
    workflow: workflowPath,
    checks,
  };
}

export function validateS07PagesProofReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["Pages workflow proof must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.slice !== "S07") errors.push("slice must be S07");
  if (report.generatedBy !== RECORDER_GENERATOR) errors.push("generatedBy must identify the S07 launch verification recorder");
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (report.status !== "pass") errors.push("status must be pass");
  if (report.workflow !== PAGES_WORKFLOW_PATH) errors.push(`workflow must be ${PAGES_WORKFLOW_PATH}`);
  const checks = new Map((report.checks ?? []).map((check) => [check.id, check]));
  for (const required of WORKFLOW_CONTRACT_CHECKS) {
    const check = checks.get(required.id);
    if (!check) errors.push(`workflow check ${required.id} is missing`);
    else if (check.status !== "pass") errors.push(`workflow check ${required.id} must pass`);
  }
  for (const finding of findPrivateReportLeakage(report)) errors.push(`Pages workflow proof leaked ${finding.description}: ${finding.match}`);
  return errors;
}

export function createS07LaunchVerificationReport({ now = new Date(), staticSmoke, launchExport, pagesProof }) {
  const staticSmokeErrors = validateS07StaticSmokeReport(staticSmoke);
  const launchExportErrors = validateS07ExportReport(launchExport);
  const pagesProofErrors = validateS07PagesProofReport(pagesProof);
  const sourceRows = Array.isArray(launchExport?.coverageContracts) ? launchExport.coverageContracts : [];
  const checkedRoutes = Array.isArray(launchExport?.checkedRoutes) ? launchExport.checkedRoutes : [];
  const smokeRoutes = Array.isArray(staticSmoke?.checkedRoutes) ? staticSmoke.checkedRoutes : [];
  const serializedCandidate = {
    launchExport,
    staticSmoke,
    pagesProof,
  };
  const redactionFindings = findPrivateReportLeakage(serializedCandidate);
  const gates = {
    routeLinkLeakage: { status: launchExportErrors.length === 0 ? "pass" : "fail", errors: launchExportErrors },
    staticSmoke: { status: staticSmokeErrors.length === 0 ? "pass" : "fail", errors: staticSmokeErrors },
    pagesWorkflow: { status: pagesProofErrors.length === 0 ? "pass" : "fail", errors: pagesProofErrors },
    redaction: { status: redactionFindings.length === 0 ? "pass" : "fail", errors: redactionFindings.map((finding) => `${finding.description}: ${finding.match}`) },
  };
  const status = Object.values(gates).every((gate) => gate.status === "pass") ? "pass" : "fail";

  return {
    schemaVersion: 1,
    slice: "S07",
    generatedBy: RECORDER_GENERATOR,
    generatedAt: now.toISOString(),
    status,
    artifacts: {
      routeLinkLeakage: LAUNCH_EXPORT_PATH,
      staticSmoke: STATIC_SMOKE_PATH,
      pagesWorkflowProof: PAGES_PROOF_PATH,
      launchVerification: S07_REPORT_PATH,
      latest: FINAL_REPORT_PATH,
    },
    summaries: {
      routes: {
        exportRoutes: checkedRoutes.length,
        staticSmokeRoutes: smokeRoutes.length,
        routeClasses: launchExport?.counts?.routeClasses ?? {},
      },
      sources: {
        expectedRegisteredSources: 24,
        coverageRaceContracts: sourceRows.length,
        minSourcesPerRace: sourceRows.length > 0 ? Math.min(...sourceRows.map((row) => Number(row.rowCount) || 0)) : 0,
        reviewedPublicPositions: sourceRows.reduce((sum, row) => sum + (Number(row.reviewedRowCount) || 0), 0),
        unresolvedSourceRows: sourceRows.reduce((sum, row) => sum + (Number(row.unresolvedRowCount) || 0), 0),
      },
      counts: {
        htmlFiles: launchExport?.counts?.htmlFiles ?? 0,
        linksChecked: launchExport?.counts?.linksChecked ?? 0,
        brokenLinks: launchExport?.counts?.brokenLinks ?? 0,
        leakFindings: launchExport?.counts?.leakFindings ?? 0,
        localOnlyRouteArtifacts: launchExport?.counts?.localOnlyRouteArtifacts ?? 0,
        redirectChecks: staticSmoke?.counts?.redirectChecks ?? 0,
        assetChecks: staticSmoke?.counts?.assetChecks ?? 0,
      },
    },
    workflowChecks: Array.isArray(pagesProof?.checks) ? pagesProof.checks : [],
    redaction: {
      status: redactionFindings.length === 0 ? "pass" : "fail",
      checkedArtifacts: [LAUNCH_EXPORT_PATH, STATIC_SMOKE_PATH, PAGES_PROOF_PATH],
      forbiddenClasses: ["private workspace paths", "file URLs", "secret-like tokens", "local-only route URLs"],
    },
    gates,
  };
}

export function validateS07LaunchVerificationReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["launch verification report must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.slice !== "S07") errors.push("slice must be S07");
  if (report.generatedBy !== RECORDER_GENERATOR) errors.push("generatedBy must identify the S07 launch verification recorder");
  if (!report.generatedAt || Number.isNaN(Date.parse(report.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (report.status !== "pass") errors.push("status must be pass");
  for (const key of ["routeLinkLeakage", "staticSmoke", "pagesWorkflow", "redaction"]) {
    if (report.gates?.[key]?.status !== "pass") errors.push(`gate ${key} must pass`);
  }
  for (const key of ["routeLinkLeakage", "staticSmoke", "pagesWorkflowProof", "launchVerification", "latest"]) {
    if (!report.artifacts?.[key] || typeof report.artifacts[key] !== "string") errors.push(`artifacts.${key} is required`);
  }
  if (!Number.isInteger(report.summaries?.routes?.exportRoutes) || report.summaries.routes.exportRoutes <= 0) errors.push("summaries.routes.exportRoutes must be positive");
  if (!Number.isInteger(report.summaries?.routes?.staticSmokeRoutes) || report.summaries.routes.staticSmokeRoutes <= 0) errors.push("summaries.routes.staticSmokeRoutes must be positive");
  if (report.summaries?.sources?.expectedRegisteredSources !== 24) errors.push("summaries.sources.expectedRegisteredSources must be 24");
  if (!Number.isInteger(report.summaries?.sources?.coverageRaceContracts) || report.summaries.sources.coverageRaceContracts <= 0) errors.push("summaries.sources.coverageRaceContracts must be positive");
  if (!Number.isInteger(report.summaries?.counts?.linksChecked) || report.summaries.counts.linksChecked < 0) errors.push("summaries.counts.linksChecked must be non-negative");
  if (report.redaction?.status !== "pass") errors.push("redaction.status must be pass");
  for (const required of WORKFLOW_CONTRACT_CHECKS) {
    const check = (report.workflowChecks ?? []).find((candidate) => candidate.id === required.id);
    if (!check || check.status !== "pass") errors.push(`workflow check ${required.id} must pass`);
  }
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
  const options = {
    staticSmokePath: STATIC_SMOKE_PATH,
    launchExportPath: LAUNCH_EXPORT_PATH,
    workflowPath: PAGES_WORKFLOW_PATH,
    pagesProofOut: PAGES_PROOF_PATH,
    reportOut: S07_REPORT_PATH,
    latestOut: FINAL_REPORT_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (["--static-smoke-json", "--smoke-json-file", "--export-json", "--launch-export-json", "--workflow", "--pages-proof-out", "--json-out", "--latest-out"].includes(arg) && !value) throw new Error(`${arg} requires a path value`);
    if (arg === "--static-smoke-json" || arg === "--smoke-json-file") options.staticSmokePath = value;
    else if (arg === "--export-json" || arg === "--launch-export-json") options.launchExportPath = value;
    else if (arg === "--workflow") options.workflowPath = value;
    else if (arg === "--pages-proof-out") options.pagesProofOut = value;
    else if (arg === "--json-out") options.reportOut = value;
    else if (arg === "--latest-out") options.latestOut = value;
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    index += 1;
  }
  return options;
}

function requireJson(relativePath, projectRoot) {
  if (!existsSync(path.join(projectRoot, relativePath))) throw new Error(`missing artifact ${relativePath}`);
  return readJson(relativePath, projectRoot);
}

function requireText(relativePath, projectRoot) {
  const fullPath = path.join(projectRoot, relativePath);
  if (!existsSync(fullPath)) throw new Error(`missing artifact ${relativePath}`);
  return readFileSync(fullPath, "utf8");
}

function main() {
  try {
    const projectRoot = process.cwd();
    const options = parseArgs();
    const launchExport = requireJson(options.launchExportPath, projectRoot);
    const staticSmoke = requireJson(options.staticSmokePath, projectRoot);
    const workflowText = requireText(options.workflowPath, projectRoot);
    const pagesProof = createS07PagesProofReport({ workflowText, workflowPath: options.workflowPath });
    const pagesProofErrors = validateS07PagesProofReport(pagesProof);
    if (pagesProofErrors.length > 0) throw new Error(`Phase pages-workflow-proof: ${pagesProofErrors.join("; ")}`);
    writeJson(options.pagesProofOut, pagesProof, projectRoot);

    const report = createS07LaunchVerificationReport({ staticSmoke, launchExport, pagesProof });
    const reportErrors = validateS07LaunchVerificationReport(report);
    if (reportErrors.length > 0) throw new Error(`Phase final-launch-report: ${reportErrors.join("; ")}`);
    writeJson(options.reportOut, report, projectRoot);
    writeJson(options.latestOut, report, projectRoot);
    console.log(`S07 launch verification recorded: ${report.summaries.routes.exportRoutes} export routes, ${report.summaries.routes.staticSmokeRoutes} smoke routes, ${report.workflowChecks.length} workflow checks, status=${report.status}.`);
  } catch (error) {
    console.error(`[record-s07-launch-verification] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
