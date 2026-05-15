#!/usr/bin/env tsx
import { runIngestion } from "../lib/ingestion/run";

interface CliOptions {
  manifest?: string;
  out?: string;
  onlySource?: string;
  allowNetwork: boolean;
  help: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!options.manifest || !options.out) {
    printHelp();
    process.exitCode = 2;
    return;
  }

  const result = await runIngestion({
    manifestPath: options.manifest,
    outDir: options.out,
    onlySource: options.onlySource,
    allowNetwork: options.allowNetwork,
  });

  const summary = result.summary;
  console.log(
    JSON.stringify(
      {
        status: summary.status,
        runId: summary.id,
        runPath: result.runPath,
        targets: summary.counts.targets,
        artifacts: summary.counts.artifacts,
        chunks: summary.counts.chunks,
        errors: summary.counts.errors,
        warnings: summary.counts.warnings,
      },
      null,
      2,
    ),
  );

  for (const target of summary.targets) {
    console.log(
      `${target.importStatus.toUpperCase()} ${target.sourceId} artifact=${target.artifactId} raw=${target.rawPath ?? "-"} clean=${target.cleanPath ?? "-"} chunks=${target.chunkPath ?? "-"}`,
    );
  }

  if (!result.ok) {
    for (const diagnostic of summary.issues) {
      if (diagnostic.severity === "error") {
        console.error(
          `ERROR ${diagnostic.code} path=${diagnostic.path} source=${diagnostic.sourceId ?? "-"} artifact=${diagnostic.artifactId ?? "-"}: ${diagnostic.message}`,
        );
      }
    }
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { allowNetwork: false, help: false };

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
      case "--only-source":
        options.onlySource = readValue(args, ++index, arg);
        break;
      case "--allow-network":
        options.allowNetwork = true;
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
  console.log(`Usage: pnpm ingest:sources -- --manifest <path> --out <dir> [--only-source <source|target|artifact>] [--allow-network]

Ingest representative voter-guide sources into raw captures, clean artifacts, chunks, and run diagnostics.

Options:
  --manifest       Path to ingestion manifest JSON.
  --out            Output root for generated ingestion files.
  --only-source    Optional sourceId, target id, or artifactId filter.
  --allow-network  Permit manifest targets with mode: "url" to fetch canonicalUrl.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ingest:sources failed: ${message}`);
  process.exitCode = 1;
});
