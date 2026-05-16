#!/usr/bin/env tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildDurableSourceRaceCoverageReport, buildSourceRaceCoverageReport, type SourceCoverageLedger, type SourceRaceCoverageIssue } from "../lib/data/sourceRaceCoverage";
import { mergeRace } from "../lib/data/loaders";
import type { Race, Source } from "../lib/data/types";

interface CliOptions {
  publicSources: string;
  publicRaces: string;
  overridesRaces: string;
  coverage: string;
  report: string;
  help: boolean;
}

interface LoadedInputs {
  sources: Source[];
  races: Race[];
  sourceCoverage: SourceCoverageLedger;
  checkedFiles: string[];
  issues: SourceRaceCoverageIssue[];
}

const DEFAULT_PUBLIC_SOURCES = "data/public/sources.json";
const DEFAULT_PUBLIC_RACES = "data/public/races";
const DEFAULT_OVERRIDES_RACES = "manual/overrides/races";
const DEFAULT_COVERAGE = "data/ingestion/source-coverage.json";
const DEFAULT_REPORT = "data/public/source-race-coverage.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const loaded = await loadInputs(options);
  const matrixReport = buildSourceRaceCoverageReport({
    sources: loaded.sources,
    races: loaded.races,
    sourceCoverage: loaded.sourceCoverage,
    sourceCoveragePath: options.coverage,
  });
  const issues = [...loaded.issues, ...matrixReport.issues].sort(compareIssues);
  const report = buildDurableSourceRaceCoverageReport(
    {
      ...matrixReport,
      ok: issues.every((issue) => issue.severity !== "error"),
      issues,
      counts: {
        ...matrixReport.counts,
        errors: issues.filter((issue) => issue.severity === "error").length,
        warnings: issues.filter((issue) => issue.severity === "warning").length,
      },
    },
    { generatedAt: new Date().toISOString(), checkedFiles: loaded.checkedFiles },
  );

  await fs.mkdir(path.dirname(options.report), { recursive: true });
  await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        status: report.ok ? "pass" : "fail",
        reportPath: options.report,
        registeredSourceCount: report.counts.registeredSourceCount,
        raceCount: report.counts.raceCount,
        totalMatrixRows: report.counts.totalMatrixRows,
        reviewedPublicRows: report.counts.reviewedPublicRows,
        awaitingReviewRows: report.counts.awaitingReviewRows,
        pendingCaptureRows: report.counts.pendingCaptureRows,
        manualOnlyRows: report.counts.manualOnlyRows,
        noPublicSourceFoundRows: report.counts.noPublicSourceFoundRows,
        noPublicPositionFoundRows: report.counts.noPublicPositionFoundRows,
        notApplicableRows: report.counts.notApplicableRows,
        errors: report.counts.errors,
        warnings: report.counts.warnings,
      },
      null,
      2,
    ),
  );

  for (const issue of report.issues) {
    const stream = issue.severity === "error" ? console.error : console.warn;
    stream(`${issue.severity.toUpperCase()} ${issue.code} path=${issue.path} source=${issue.sourceId ?? "-"} race=${issue.raceSlug ?? issue.raceId ?? "-"}: ${issue.message}`);
  }

  if (!report.ok) process.exitCode = 1;
}

async function loadInputs(options: CliOptions): Promise<LoadedInputs> {
  const checkedFiles: string[] = [];
  const issues: SourceRaceCoverageIssue[] = [];
  const sourcesJson = await readJson(options.publicSources, checkedFiles, issues);
  const coverageJson = await readJson(options.coverage, checkedFiles, issues);
  const sources = readSources(sourcesJson, options.publicSources, issues);
  const sourceCoverage = readCoverage(coverageJson, options.coverage, issues);
  const races = await readRaces(options.publicRaces, options.overridesRaces, checkedFiles, issues);
  return { sources, races, sourceCoverage, checkedFiles: [...new Set(checkedFiles)].sort(), issues };
}

async function readRaces(racesDir: string, overridesDir: string, checkedFiles: string[], issues: SourceRaceCoverageIssue[]): Promise<Race[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(racesDir);
  } catch (error) {
    issues.push({ code: "read_error", severity: "error", path: racesDir, message: `Unable to read public races directory: ${formatError(error)}` });
    return [];
  }

  const races: Race[] = [];
  for (const entry of entries.filter((file) => file.endsWith(".json")).sort()) {
    const canonicalPath = path.join(racesDir, entry);
    const canonicalJson = await readJson(canonicalPath, checkedFiles, issues);
    const canonicalRace = readRace(canonicalJson, canonicalPath, issues);
    if (!canonicalRace) continue;

    const overridePath = path.join(overridesDir, entry);
    const overrideJson = await readOptionalJson(overridePath, checkedFiles, issues);
    const overrideRace = overrideJson === undefined ? undefined : readPartialRace(overrideJson, overridePath, issues);
    if (!overrideRace) {
      races.push(canonicalRace);
      continue;
    }

    try {
      races.push(mergeRace(canonicalRace, overrideRace, canonicalRace.slug, overridePath));
    } catch (error) {
      issues.push({
        code: "invalid_race_override",
        severity: "error",
        path: overridePath,
        message: `Unable to merge race override for ${canonicalRace.slug}: ${formatError(error)}`,
        raceSlug: canonicalRace.slug,
      });
      races.push(canonicalRace);
    }
  }
  return races;
}

async function readJson(filePath: string, checkedFiles: string[], issues: SourceRaceCoverageIssue[]): Promise<unknown> {
  checkedFiles.push(filePath);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    issues.push({ code: isSyntaxError(error) ? "malformed_json" : "read_error", severity: "error", path: filePath, message: formatError(error) });
    return undefined;
  }
}

async function readOptionalJson(filePath: string, checkedFiles: string[], issues: SourceRaceCoverageIssue[]): Promise<unknown | undefined> {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    issues.push({ code: "read_error", severity: "error", path: filePath, message: formatError(error) });
    return undefined;
  }
  return readJson(filePath, checkedFiles, issues);
}

function readSources(value: unknown, filePath: string, issues: SourceRaceCoverageIssue[]): Source[] {
  if (isRecord(value) && Array.isArray(value.sources)) return value.sources as Source[];
  issues.push({ code: "invalid_sources_shape", severity: "error", path: `${filePath}.sources`, message: "Expected top-level sources array." });
  return [];
}

function readCoverage(value: unknown, filePath: string, issues: SourceRaceCoverageIssue[]): SourceCoverageLedger {
  if (isRecord(value)) return value as SourceCoverageLedger;
  issues.push({ code: "invalid_coverage_shape", severity: "error", path: filePath, message: "Expected source coverage ledger object." });
  return { sources: [] };
}

function readRace(value: unknown, filePath: string, issues: SourceRaceCoverageIssue[]): Race | undefined {
  if (isRecord(value) && isRecord(value.race)) return value.race as unknown as Race;
  issues.push({ code: "invalid_race_shape", severity: "error", path: `${filePath}.race`, message: "Expected top-level race object." });
  return undefined;
}

function readPartialRace(value: unknown, filePath: string, issues: SourceRaceCoverageIssue[]): Partial<Race> | undefined {
  if (isRecord(value) && isRecord(value.race)) return value.race as Partial<Race>;
  issues.push({ code: "invalid_race_override_shape", severity: "error", path: `${filePath}.race`, message: "Expected top-level race object." });
  return undefined;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    publicSources: DEFAULT_PUBLIC_SOURCES,
    publicRaces: DEFAULT_PUBLIC_RACES,
    overridesRaces: DEFAULT_OVERRIDES_RACES,
    coverage: DEFAULT_COVERAGE,
    report: DEFAULT_REPORT,
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
      case "--public-races":
        options.publicRaces = readValue(args, ++index, arg);
        break;
      case "--overrides-races":
        options.overridesRaces = readValue(args, ++index, arg);
        break;
      case "--coverage":
        options.coverage = readValue(args, ++index, arg);
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
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: pnpm report:source-race-coverage [-- --public-sources <path> --public-races <dir> --overrides-races <dir> --coverage <path> --report <path>]

Build deterministic source-by-race public coverage diagnostics.

Defaults:
  --public-sources  ${DEFAULT_PUBLIC_SOURCES}
  --public-races    ${DEFAULT_PUBLIC_RACES}
  --overrides-races ${DEFAULT_OVERRIDES_RACES}
  --coverage        ${DEFAULT_COVERAGE}
  --report          ${DEFAULT_REPORT}
`);
}

function compareIssues(left: SourceRaceCoverageIssue, right: SourceRaceCoverageIssue): number {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || (left.sourceId ?? "").localeCompare(right.sourceId ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`report:source-race-coverage failed: ${message}`);
    process.exitCode = 1;
  });
}
