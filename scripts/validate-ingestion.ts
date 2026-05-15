#!/usr/bin/env tsx
import path from "node:path";
import { validateIngestion, writeValidationReport } from "../lib/ingestion/validate";

interface CliOptions {
  manifest: string;
  out: string;
  publicSources: string;
  report?: string;
  help: boolean;
}

const DEFAULT_MANIFEST = "data/ingestion/manifest.json";
const DEFAULT_OUT = "data/ingested";
const DEFAULT_PUBLIC_SOURCES = "data/public/sources.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const reportPath = options.report ?? path.join(options.out, "validation/latest.json");
  const result = await validateIngestion({
    manifestPath: options.manifest,
    outDir: options.out,
    publicSourcesPath: options.publicSources,
  });
  await writeValidationReport(reportPath, result);

  console.log(
    JSON.stringify(
      {
        status: result.ok ? "pass" : "fail",
        reportPath,
        checkedFiles: result.checkedFiles.length,
        targets: result.counts.targets,
        artifacts: result.counts.artifacts,
        chunks: result.counts.chunks,
        errors: result.counts.errors,
        warnings: result.counts.warnings,
      },
      null,
      2,
    ),
  );

  for (const diagnostic of result.issues) {
    const stream = diagnostic.severity === "error" ? console.error : console.warn;
    stream(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code} path=${diagnostic.path} source=${diagnostic.sourceId ?? "-"} artifact=${diagnostic.artifactId ?? "-"}: ${diagnostic.message}`,
    );
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    manifest: DEFAULT_MANIFEST,
    out: DEFAULT_OUT,
    publicSources: DEFAULT_PUBLIC_SOURCES,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--":
        break;
      case "--manifest":
        options.manifest = readValue(args, ++index, arg);
        break;
      case "--out":
        options.out = readValue(args, ++index, arg);
        break;
      case "--public-sources":
        options.publicSources = readValue(args, ++index, arg);
        break;
      case "--report":
        options.report = readValue(args, ++index, arg);
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
  console.log(`Usage: pnpm validate-ingestion [-- --manifest <path> --out <dir> --public-sources <path> --report <path>]

Validate generated ingestion outputs for S04 consumption.

Defaults:
  --manifest        ${DEFAULT_MANIFEST}
  --out             ${DEFAULT_OUT}
  --public-sources  ${DEFAULT_PUBLIC_SOURCES}
  --report          <out>/validation/latest.json
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`validate-ingestion failed: ${message}`);
  process.exitCode = 1;
});
