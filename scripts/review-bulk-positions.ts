#!/usr/bin/env tsx
import { runBulkPositionReview, type BulkReviewOptions } from "../lib/review/bulk";

interface CliOptions extends BulkReviewOptions {
  help?: boolean;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, issue: { code: "review_bulk_cli_error", message: error instanceof Error ? sanitize(error.message) : String(error) } }, null, 2));
  process.exit(1);
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const result = await runBulkPositionReview(options);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--draft") parsed.draftPath = requireValue(args, ++index, arg);
    else if (arg === "--manifest") parsed.manifestPath = requireValue(args, ++index, arg);
    else if (arg === "--reviews-dir") parsed.reviewsDir = requireValue(args, ++index, arg);
    else if (arg === "--overrides-dir") parsed.overridesDir = requireValue(args, ++index, arg);
    else if (arg === "--public-dir") parsed.publicDir = requireValue(args, ++index, arg);
    else if (arg === "--diagnostics-dir") parsed.diagnosticsDir = requireValue(args, ++index, arg);
    else if (arg === "--diagnostics-path") parsed.diagnosticsPath = requireValue(args, ++index, arg);
    else throw new Error(`Unknown argument '${arg}'. Use --help for usage.`);
  }
  return parsed;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: pnpm review:bulk [options]\n\nValidates an extraction draft, writes race review JSON, publishes only evidence-backed public records through the existing review publisher, and persists bulk diagnostics.\n\nOptions:\n  --draft <path>              Extraction draft path (default: data/extracted/drafts/latest.json)\n  --manifest <path>           Ingestion manifest path (default: data/ingestion/manifest.json)\n  --reviews-dir <path>        Review root (default: manual/reviews)\n  --overrides-dir <path>      Override root (default: manual/overrides)\n  --public-dir <path>         Public data root (default: data/public)\n  --diagnostics-dir <path>    Diagnostics root (default: data/reviewed)\n  --diagnostics-path <path>   Exact diagnostics report path\n  -h, --help                  Show this help`);
}

function sanitize(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
