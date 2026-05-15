#!/usr/bin/env tsx
import { runExtraction } from "../lib/extraction/run";

interface CliOptions {
  manifest?: string;
  outDir?: string;
  provider?: string;
  model?: string;
  raceSlug?: string;
  dryRun?: boolean;
  promptPreview?: boolean;
  maxChunkChars?: number;
  help?: boolean;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "failed", issue: { code: "extract_cli_error", message: error instanceof Error ? sanitize(error.message) : String(error) } }, null, 2));
  process.exit(1);
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const result = await runExtraction({ manifestPath: options.manifest, outDir: options.outDir, provider: options.provider, model: options.model, raceSlug: options.raceSlug, dryRun: options.dryRun, promptPreview: options.promptPreview, maxChunkChars: options.maxChunkChars });
  console.log(JSON.stringify({ status: result.run.status, provider: result.run.provider.provider, model: result.run.provider.model, promptVersion: result.run.promptVersion, counts: result.run.counts, outputPath: result.run.outputPath, validationPath: result.run.validationPath, issueCodes: result.run.issues.map((issue) => issue.code) }, null, 2));
  process.exit(result.run.status === "failed" ? 1 : 0);
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--manifest") parsed.manifest = requireValue(args, ++index, arg);
    else if (arg === "--out-dir") parsed.outDir = requireValue(args, ++index, arg);
    else if (arg === "--provider") parsed.provider = requireValue(args, ++index, arg);
    else if (arg === "--model") parsed.model = requireValue(args, ++index, arg);
    else if (arg === "--race-slug") parsed.raceSlug = requireValue(args, ++index, arg);
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--prompt-preview") parsed.promptPreview = true;
    else if (arg === "--max-chunk-chars") parsed.maxChunkChars = Number(requireValue(args, ++index, arg));
    else throw new Error(`Unknown flag '${arg}'. Use --help for usage.`);
  }
  return parsed;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: pnpm extract:positions [options]\n\nRuns LLM-compatible position extraction over clean ingested artifacts/chunks.\n\nOptions:\n  --manifest <path>       Ingestion manifest path (default: data/ingestion/manifest.json)\n  --out-dir <path>        Output directory (default: data/extracted)\n  --provider <name>       Provider: openai or fixture (default: openai)\n  --model <name>          Provider model (default: gpt-4o-mini, fixture-v1 for fixture)\n  --race-slug <slug>      Restrict extraction to one race slug\n  --dry-run               Assemble prompts and diagnostics without provider calls\n  --prompt-preview        Persist prompts inside data/extracted/runs/latest.json\n  --max-chunk-chars <n>   Reject chunks above this size before provider calls\n  -h, --help              Show this help\n\nDiagnostics are written to data/extracted/runs/latest.json and data/extracted/validation/latest.json. API keys are read from OPENAI_API_KEY and are never printed.`);
}

function sanitize(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
