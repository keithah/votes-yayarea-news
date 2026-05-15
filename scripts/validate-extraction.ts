#!/usr/bin/env tsx
import { validatePersistedExtraction } from "../lib/extraction/run";

interface CliOptions {
  draft?: string;
  validationPath?: string;
  manifest?: string;
  raceSlug?: string;
  help?: boolean;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, issue: { code: "validate_extraction_cli_error", message: error instanceof Error ? sanitize(error.message) : String(error) } }, null, 2));
  process.exit(1);
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const report = await validatePersistedExtraction({ draftPath: options.draft, validationPath: options.validationPath, manifestPath: options.manifest, raceSlug: options.raceSlug });
  console.log(JSON.stringify({ ok: report.ok, counts: report.counts, issueCodes: report.issues.map((issue) => issue.code), checkedFiles: report.checkedFiles }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--draft") parsed.draft = requireValue(args, ++index, arg);
    else if (arg === "--validation-path") parsed.validationPath = requireValue(args, ++index, arg);
    else if (arg === "--manifest") parsed.manifest = requireValue(args, ++index, arg);
    else if (arg === "--race-slug") parsed.raceSlug = requireValue(args, ++index, arg);
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
  console.log(`Usage: pnpm validate-extraction [options]\n\nValidates persisted extraction drafts against public race data and ingested artifact/chunk files.\n\nOptions:\n  --draft <path>             Draft file (default: data/extracted/drafts/latest.json)\n  --validation-path <path>   Validation report output (default: data/extracted/validation/latest.json)\n  --manifest <path>          Ingestion manifest path (default: data/ingestion/manifest.json)\n  --race-slug <slug>         Restrict validation input context to one race slug\n  -h, --help                 Show this help`);
}

function sanitize(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
