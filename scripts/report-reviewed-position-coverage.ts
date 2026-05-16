#!/usr/bin/env tsx
import path from "node:path";
import { buildReviewedPositionCoverageReport, writeReviewedPositionCoverageReport } from "../lib/review/coverage";

interface CliOptions {
  publicDir: string;
  overridesDir: string;
  sourceCoverage: string;
  ingestedCoverage: string;
  ingestedValidation: string;
  bulkDiagnostics?: string;
  report: string;
  help: boolean;
}

const DEFAULT_PUBLIC_DIR = "data/public";
const DEFAULT_OVERRIDES_DIR = "manual/overrides";
const DEFAULT_SOURCE_COVERAGE = "data/ingestion/source-coverage.json";
const DEFAULT_INGESTED_COVERAGE = "data/ingested/coverage/latest.json";
const DEFAULT_INGESTED_VALIDATION = "data/ingested/validation/latest.json";
const DEFAULT_REPORT = "data/reviewed/position-coverage.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = await buildReviewedPositionCoverageReport({
    publicDir: options.publicDir,
    overridesDir: options.overridesDir,
    sourceCoveragePath: options.sourceCoverage,
    ingestedCoveragePath: options.ingestedCoverage,
    ingestedValidationPath: options.ingestedValidation,
    bulkDiagnosticsPath: options.bulkDiagnostics,
    outPath: options.report,
  });
  await writeReviewedPositionCoverageReport(options.report, report);

  console.log(
    JSON.stringify(
      {
        status: report.ok ? "pass" : "fail",
        reportPath: options.report,
        races: report.counts.races,
        publicRaces: report.counts.publicRaces,
        publicPositions: report.counts.publicPositions,
        publicEvidence: report.counts.publicEvidence,
        reviewedPublicPositions: report.counts.reviewedPublicPositions,
        evidenceBackedPublicPositions: report.counts.evidenceBackedPublicPositions,
        unpublished: report.unpublishedCounts.total,
        unpublishedByReasonCode: report.unpublishedCounts.byReasonCode,
        provenanceCompleteEvidence: report.counts.provenanceCompleteEvidence,
        provenancePartialEvidence: report.counts.provenancePartialEvidence,
        provenanceAbsentEvidence: report.counts.provenanceAbsentEvidence,
        endorse: report.counts.endorse,
        oppose: report.counts.oppose,
        noPosition: report.counts.noPosition,
        informational: report.counts.informational,
        errors: report.counts.errors,
        warnings: report.counts.warnings,
      },
      null,
      2,
    ),
  );

  for (const diagnostic of report.issues) {
    const stream = diagnostic.severity === "error" ? console.error : console.warn;
    stream(`${diagnostic.severity.toUpperCase()} ${diagnostic.code} path=${diagnostic.path} race=${diagnostic.raceSlug ?? "-"} source=${diagnostic.sourceId ?? "-"} entity=${diagnostic.entityId ?? "-"}: ${diagnostic.message}`);
  }

  if (!report.ok) process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    publicDir: DEFAULT_PUBLIC_DIR,
    overridesDir: DEFAULT_OVERRIDES_DIR,
    sourceCoverage: DEFAULT_SOURCE_COVERAGE,
    ingestedCoverage: DEFAULT_INGESTED_COVERAGE,
    ingestedValidation: DEFAULT_INGESTED_VALIDATION,
    bulkDiagnostics: undefined,
    report: DEFAULT_REPORT,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    else if (arg === "--public-dir") options.publicDir = readValue(args, ++index, arg);
    else if (arg === "--overrides-dir") options.overridesDir = readValue(args, ++index, arg);
    else if (arg === "--source-coverage") options.sourceCoverage = readValue(args, ++index, arg);
    else if (arg === "--ingested-coverage") options.ingestedCoverage = readValue(args, ++index, arg);
    else if (arg === "--ingested-validation") options.ingestedValidation = readValue(args, ++index, arg);
    else if (arg === "--bulk-diagnostics") options.bulkDiagnostics = readValue(args, ++index, arg);
    else if (arg === "--report") options.report = readValue(args, ++index, arg);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: pnpm review:coverage [-- --public-dir <path> --overrides-dir <path> --source-coverage <path> --ingested-coverage <path> --ingested-validation <path> --bulk-diagnostics <path> --report <path>]\n\nBuild deterministic reviewed public-position coverage diagnostics.\n\nDefaults:\n  --public-dir           ${DEFAULT_PUBLIC_DIR}\n  --overrides-dir        ${DEFAULT_OVERRIDES_DIR}\n  --source-coverage      ${DEFAULT_SOURCE_COVERAGE}\n  --ingested-coverage    ${DEFAULT_INGESTED_COVERAGE}\n  --ingested-validation  ${DEFAULT_INGESTED_VALIDATION}\n  --report               ${DEFAULT_REPORT}\n\nExample:\n  pnpm review:coverage`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`review:coverage failed: ${sanitize(message)}`);
  process.exitCode = 1;
});

function sanitize(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
