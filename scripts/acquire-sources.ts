#!/usr/bin/env tsx
import { acquireSources } from "../lib/acquisition/acquire-sources";
import type { AcquisitionDiagnostic } from "../lib/acquisition/types";

interface CliOptions {
  sources: string;
  candidates: string;
  out: string;
  manifest: string;
  allowNetwork: boolean;
  fetchTimeoutMs?: number;
  maxCandidateBytes?: number;
  maxSources?: number;
  help: boolean;
}

const DEFAULT_SOURCES = "data/public/sources.json";
const DEFAULT_CANDIDATES = "data/acquisition/source-candidates.json";
const DEFAULT_OUT = "data/acquisition";
const DEFAULT_MANIFEST = "data/ingestion/m004-live-manifest.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await acquireSources({
    sourcesPath: options.sources,
    candidatesPath: options.candidates,
    acquisitionDir: options.out,
    manifestPath: options.manifest,
    allowNetwork: options.allowNetwork,
    fetchTimeoutMs: options.fetchTimeoutMs,
    maxCandidateBytes: options.maxCandidateBytes,
    maxSources: options.maxSources,
  });

  const counts = {
    status: result.ok ? "pass" : "fail",
    diagnostics: result.diagnostics.length,
    captured: result.diagnostics.filter((item) => item.status === "captured").length,
    manifestTargets: result.manifest?.targets.length ?? 0,
    reportPath: result.reportPath ?? `${options.out}/latest.json`,
    manifestPath: options.manifest,
  };
  console.log(JSON.stringify(counts, null, 2));

  for (const diagnostic of result.diagnostics) {
    const line = formatDiagnostic(diagnostic);
    if (diagnostic.status === "invalid_candidate" || diagnostic.status === "invalid_source") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    sources: DEFAULT_SOURCES,
    candidates: DEFAULT_CANDIDATES,
    out: DEFAULT_OUT,
    manifest: DEFAULT_MANIFEST,
    allowNetwork: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--":
        break;
      case "--sources":
        options.sources = readValue(args, ++index, arg);
        break;
      case "--candidates":
        options.candidates = readValue(args, ++index, arg);
        break;
      case "--out":
        options.out = readValue(args, ++index, arg);
        break;
      case "--manifest":
        options.manifest = readValue(args, ++index, arg);
        break;
      case "--allow-network":
        options.allowNetwork = true;
        break;
      case "--fetch-timeout-ms":
        options.fetchTimeoutMs = Number.parseInt(readValue(args, ++index, arg), 10);
        break;
      case "--max-candidate-bytes":
        options.maxCandidateBytes = Number.parseInt(readValue(args, ++index, arg), 10);
        break;
      case "--max-sources":
        options.maxSources = Number.parseInt(readValue(args, ++index, arg), 10);
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

function formatDiagnostic(diagnostic: AcquisitionDiagnostic): string {
  return [
    diagnostic.status.toUpperCase(),
    diagnostic.sourceId,
    `phase=${diagnostic.phase}`,
    `url=${diagnostic.attemptedUrl ?? "-"}`,
    `artifact=${diagnostic.capturedArtifactPath ?? "-"}`,
    `manifest=${diagnostic.manifestIncluded ? "yes" : "no"}`,
    diagnostic.path ? `path=${diagnostic.path}` : undefined,
    diagnostic.skippedReason ? `reason=${diagnostic.skippedReason}` : undefined,
    diagnostic.error ? `error=${diagnostic.error.code}:${diagnostic.error.message}` : undefined,
  ].filter(Boolean).join(" ");
}

function printHelp(): void {
  console.log(`Usage: pnpm acquire:sources -- [--allow-network] [--sources <path>] [--candidates <path>] [--out <dir>] [--manifest <path>]

Capture public source candidate pages into durable fixtures and write M004/S01 acquisition diagnostics.

Defaults:
  --sources     ${DEFAULT_SOURCES}
  --candidates  ${DEFAULT_CANDIDATES}
  --out         ${DEFAULT_OUT}
  --manifest    ${DEFAULT_MANIFEST}

Options:
  --allow-network         Permit fetching candidate URLs. Without this flag, registered sources with candidates are diagnostic-only.
  --fetch-timeout-ms      Per-candidate timeout in milliseconds.
  --max-candidate-bytes   Per-candidate byte limit.
  --max-sources           Limit source count for bounded smoke runs.
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`acquire:sources failed: ${message}`);
  process.exitCode = 1;
});
