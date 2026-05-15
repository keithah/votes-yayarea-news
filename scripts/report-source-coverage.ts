#!/usr/bin/env tsx
import path from "node:path";
import { buildSourceCoverageReport, writeSourceCoverageReport } from "../lib/ingestion/sourceCoverage";

interface CliOptions {
  publicSources: string;
  manifest: string;
  coverage: string;
  out: string;
  report?: string;
  run?: string;
  help: boolean;
}

const DEFAULT_PUBLIC_SOURCES = "data/public/sources.json";
const DEFAULT_MANIFEST = "data/ingestion/manifest.json";
const DEFAULT_COVERAGE = "data/ingestion/source-coverage.json";
const DEFAULT_OUT = "data/ingested";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const reportPath = options.report ?? path.join(options.out, "coverage/latest.json");
  const runPath = options.run ?? path.join(options.out, "runs/latest.json");
  const report = await buildSourceCoverageReport({
    publicSourcesPath: options.publicSources,
    manifestPath: options.manifest,
    coveragePath: options.coverage,
    runPath,
  });
  await writeSourceCoverageReport(reportPath, report);

  console.log(
    JSON.stringify(
      {
        status: report.ok ? "pass" : "fail",
        reportPath,
        sources: report.counts.sources,
        captured: report.counts.captured,
        pending: report.counts.pending,
        excluded: report.counts.excluded,
        manualOnly: report.counts.manualOnly,
        unavailable: report.counts.unavailable,
        runtimeCaptured: report.counts.runtimeCaptured,
        runtimeFailed: report.counts.runtimeFailed,
        runtimeUnknown: report.counts.runtimeUnknown,
        errors: report.counts.errors,
        warnings: report.counts.warnings,
      },
      null,
      2,
    ),
  );

  for (const diagnostic of report.issues) {
    const stream = diagnostic.severity === "error" ? console.error : console.warn;
    stream(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code} path=${diagnostic.path} source=${diagnostic.sourceId ?? "-"} artifact=${diagnostic.artifactId ?? "-"}: ${diagnostic.message}`,
    );
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    publicSources: DEFAULT_PUBLIC_SOURCES,
    manifest: DEFAULT_MANIFEST,
    coverage: DEFAULT_COVERAGE,
    out: DEFAULT_OUT,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--":
        break;
      case "--public-sources":
        options.publicSources = readValue(args, ++index, arg);
        break;
      case "--manifest":
        options.manifest = readValue(args, ++index, arg);
        break;
      case "--coverage":
        options.coverage = readValue(args, ++index, arg);
        break;
      case "--out":
        options.out = readValue(args, ++index, arg);
        break;
      case "--report":
        options.report = readValue(args, ++index, arg);
        break;
      case "--run":
        options.run = readValue(args, ++index, arg);
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage: pnpm report:source-coverage [-- --public-sources <path> --manifest <path> --coverage <path> --out <dir> --run <path> --report <path>]

Build deterministic M002 source availability coverage diagnostics.

Defaults:
  --public-sources  ${DEFAULT_PUBLIC_SOURCES}
  --manifest        ${DEFAULT_MANIFEST}
  --coverage        ${DEFAULT_COVERAGE}
  --out             ${DEFAULT_OUT}
  --run             <out>/runs/latest.json
  --report          <out>/coverage/latest.json
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`report:source-coverage failed: ${message}`);
  process.exitCode = 1;
});
