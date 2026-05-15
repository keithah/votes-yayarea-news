#!/usr/bin/env tsx
import { preparePositionReview, publishPositionReview, statusPositionReview, type ReviewCommand, type ReviewWorkflowOptions, type ReviewWorkflowResult } from "../lib/review/positions";

interface CliOptions extends ReviewWorkflowOptions {
  command?: ReviewCommand;
  help?: boolean;
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, issue: { code: "review_positions_cli_error", message: error instanceof Error ? sanitize(error.message) : String(error) } }, null, 2));
  process.exit(1);
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  if (!options.command) throw new Error("Missing command. Use prepare, status, or publish.");
  if (!options.raceSlug) throw new Error("Missing --race-slug <slug>.");

  let result: ReviewWorkflowResult;
  if (options.command === "prepare") result = await preparePositionReview(options);
  else if (options.command === "status") result = await statusPositionReview(options);
  else result = await publishPositionReview(options);

  console.log(JSON.stringify({ ok: result.ok, command: result.command, raceSlug: result.raceSlug, phase: result.phase, counts: result.counts, reviewPath: result.reviewPath, sourceDraftPath: result.sourceDraftPath, overridePath: result.overridePath, issueCodes: result.issues.map((issue) => issue.code), issues: result.issues, checkedFiles: result.checkedFiles, publicPositionIds: result.publicPositionIds }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = { raceSlug: "" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    else if (index === 0 && (arg === "prepare" || arg === "status" || arg === "publish")) parsed.command = arg;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--race-slug") parsed.raceSlug = requireValue(args, ++index, arg);
    else if (arg === "--draft") parsed.draftPath = requireValue(args, ++index, arg);
    else if (arg === "--reviews-dir") parsed.reviewsDir = requireValue(args, ++index, arg);
    else if (arg === "--overrides-dir") parsed.overridesDir = requireValue(args, ++index, arg);
    else if (arg === "--public-dir") parsed.publicDir = requireValue(args, ++index, arg);
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
  console.log(`Usage: pnpm review:positions <command> --race-slug <slug> [options]\n\nPrepares, inspects, and publishes local extraction review JSON. Static review pages are read-only; edit manual/reviews/races/<slug>.json locally before publishing.\n\nCommands:\n  prepare                  Create/update manual review JSON from an extraction draft without publishing\n  status                   Validate review JSON and print readiness diagnostics\n  publish                  Merge verified public review records into manual overrides and run load checks\n\nOptions:\n  --race-slug <slug>       Race slug to review (required)\n  --draft <path>           Extraction draft path (default: data/extracted/drafts/latest.json)\n  --reviews-dir <path>     Review root (default: manual/reviews)\n  --overrides-dir <path>   Override root (default: manual/overrides)\n  --public-dir <path>      Public data root (default: data/public)\n  -h, --help               Show this help`);
}

function sanitize(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
