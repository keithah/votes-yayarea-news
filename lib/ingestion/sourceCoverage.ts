import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  IngestionManifest,
  IngestionRunSummary,
  IngestionTarget,
  IngestionValidationIssue,
  KebabCaseId,
} from "./types";

export type SourceCoverageStatus = "captured" | "pending" | "excluded" | "manual-only" | "unavailable";
export type SourceCoverageRuntimeStatus = "captured" | "failed" | "pending" | "skipped" | "unknown";

export interface SourceCoverageManifest {
  version: 1;
  description?: string;
  sources: SourceCoverageEntry[];
}

export interface SourceCoverageEntry {
  sourceId: KebabCaseId;
  status: SourceCoverageStatus;
  targetId?: KebabCaseId;
  guideUrl?: string;
  relevantRaceSlugs?: string[];
  ballotUniverseGaps?: string[];
  reason?: string;
  notes?: string;
}

export interface SourceCoverageReport {
  ok: boolean;
  generatedAt: string;
  checkedFiles: string[];
  counts: SourceCoverageCounts;
  sources: SourceCoverageSourceReport[];
  issues: IngestionValidationIssue[];
}

export interface SourceCoverageCounts {
  sources: number;
  captured: number;
  pending: number;
  excluded: number;
  manualOnly: number;
  unavailable: number;
  runtimeCaptured: number;
  runtimeFailed: number;
  runtimeUnknown: number;
  errors: number;
  warnings: number;
}

export interface SourceCoverageSourceReport {
  sourceId: KebabCaseId;
  name: string;
  status: SourceCoverageStatus;
  runtimeStatus: SourceCoverageRuntimeStatus;
  targetId?: KebabCaseId;
  artifactId?: KebabCaseId;
  guideUrl?: string;
  homepageUrl?: string;
  relevantRaceSlugs?: string[];
  ballotUniverseGaps?: string[];
  reason?: string;
  notes?: string;
}

export interface BuildSourceCoverageOptions {
  publicSourcesPath: string;
  manifestPath: string;
  coveragePath: string;
  runPath?: string;
  now?: () => Date;
}

interface PublicSourcesFile {
  sources?: PublicSource[];
}

interface PublicSource {
  id?: unknown;
  name?: unknown;
  homepageUrl?: unknown;
  guideUrl?: unknown;
}

interface LoadedJson<T> {
  value?: T;
  ok: boolean;
  missing: boolean;
}

const STATUS_COUNT_KEYS: Record<SourceCoverageStatus, keyof Pick<SourceCoverageCounts, "captured" | "pending" | "excluded" | "manualOnly" | "unavailable">> = {
  captured: "captured",
  pending: "pending",
  excluded: "excluded",
  "manual-only": "manualOnly",
  unavailable: "unavailable",
};

export async function buildSourceCoverageReport(options: BuildSourceCoverageOptions): Promise<SourceCoverageReport> {
  const checkedFiles = new Set<string>();
  const issues: IngestionValidationIssue[] = [];
  const runPath = options.runPath ?? "data/ingested/runs/latest.json";

  const publicSourcesLoad = await readJson<PublicSourcesFile>(options.publicSourcesPath, checkedFiles, issues, "public_sources_json_malformed", "error");
  const manifestLoad = await readJson<IngestionManifest>(options.manifestPath, checkedFiles, issues, "manifest_json_malformed", "error");
  const coverageLoad = await readJson<SourceCoverageManifest>(options.coveragePath, checkedFiles, issues, "coverage_json_malformed", "error");
  const runLoad = await readJson<IngestionRunSummary>(runPath, checkedFiles, issues, "run_summary_json_malformed", "warning", { missingIsIssue: false });

  const publicSources = Array.isArray(publicSourcesLoad.value?.sources) ? publicSourcesLoad.value.sources : [];
  if (publicSourcesLoad.value && !Array.isArray(publicSourcesLoad.value.sources)) {
    issues.push(issue("invalid_public_sources", "error", `${options.publicSourcesPath}.sources`, "Public sources file must contain a sources array."));
  }
  if (manifestLoad.value && !Array.isArray(manifestLoad.value.targets)) {
    issues.push(issue("invalid_manifest_targets", "error", `${options.manifestPath}.targets`, "Manifest targets must be an array."));
  }
  if (coverageLoad.value && !Array.isArray(coverageLoad.value.sources)) {
    issues.push(issue("invalid_coverage_sources", "error", `${options.coveragePath}.sources`, "Coverage file must contain a sources array."));
  }

  const sourceById = collectPublicSources(publicSources, options.publicSourcesPath, issues);
  const targets = Array.isArray(manifestLoad.value?.targets) ? manifestLoad.value.targets : [];
  const targetById = collectTargets(targets, sourceById, options.manifestPath, issues);
  const coverageEntries = Array.isArray(coverageLoad.value?.sources) ? coverageLoad.value.sources : [];
  const coverageBySourceId = collectCoverageEntries(coverageEntries, sourceById, targetById, options.coveragePath, issues);
  const runtimeByTargetId = collectRuntime(runLoad.value, targetById, runPath, issues);

  for (const sourceId of sourceById.keys()) {
    if (!coverageBySourceId.has(sourceId)) {
      issues.push(issue("missing_source_coverage", "error", `${options.coveragePath}.sources`, `Source ${sourceId} is missing from source coverage ledger.`, { sourceId }));
    }
  }

  const reports: SourceCoverageSourceReport[] = [];
  for (const [sourceId, source] of Array.from(sourceById.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const coverage = coverageBySourceId.get(sourceId);
    if (!coverage) {
      continue;
    }
    const target = coverage.targetId ? targetById.get(coverage.targetId) : undefined;
    reports.push({
      sourceId,
      name: stringValue(source.name) || sourceId,
      status: coverage.status,
      runtimeStatus: target ? runtimeStatusForTarget(target.id, runtimeByTargetId) : "unknown",
      targetId: target?.id ?? coverage.targetId,
      artifactId: target?.artifactId,
      guideUrl: coverage.guideUrl ?? stringValue(source.guideUrl),
      homepageUrl: stringValue(source.homepageUrl),
      relevantRaceSlugs: normalizeStringArray(coverage.relevantRaceSlugs),
      ballotUniverseGaps: normalizeStringArray(coverage.ballotUniverseGaps),
      reason: coverage.reason,
      notes: coverage.notes,
    });
  }

  const sortedIssues = issues.sort(compareIssues);
  const counts = countCoverage(reports, sortedIssues);
  return {
    ok: counts.errors === 0,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    checkedFiles: Array.from(checkedFiles).sort(),
    counts,
    sources: reports,
    issues: sortedIssues,
  };
}

export async function writeSourceCoverageReport(reportPath: string, report: SourceCoverageReport): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function collectPublicSources(
  publicSources: PublicSource[],
  publicSourcesPath: string,
  issues: IngestionValidationIssue[],
): Map<string, PublicSource> {
  const sourceById = new Map<string, PublicSource>();
  publicSources.forEach((source, index) => {
    const sourcePath = `${publicSourcesPath}.sources[${index}]`;
    const sourceId = stringValue(source.id);
    if (!sourceId) {
      issues.push(issue("missing_public_source_id", "error", `${sourcePath}.id`, "Public source must include an id."));
      return;
    }
    if (sourceById.has(sourceId)) {
      issues.push(issue("duplicate_public_source_id", "error", `${sourcePath}.id`, `Duplicate public source id ${sourceId}.`, { sourceId }));
    }
    sourceById.set(sourceId, source);
    validateOptionalUrl(source.homepageUrl, `${sourcePath}.homepageUrl`, issues, { sourceId });
    validateOptionalUrl(source.guideUrl, `${sourcePath}.guideUrl`, issues, { sourceId });
  });
  return sourceById;
}

function collectTargets(
  targets: IngestionTarget[],
  sourceById: Map<string, PublicSource>,
  manifestPath: string,
  issues: IngestionValidationIssue[],
): Map<string, IngestionTarget> {
  const targetById = new Map<string, IngestionTarget>();
  targets.forEach((target, index) => {
    const targetPath = `${manifestPath}.targets[${index}]`;
    if (targetById.has(target.id)) {
      issues.push(issue("duplicate_manifest_target", "error", `${targetPath}.id`, `Duplicate manifest target id ${target.id}.`, target));
    }
    targetById.set(target.id, target);
    if (!sourceById.has(target.sourceId)) {
      issues.push(issue("unknown_manifest_source_id", "error", `${targetPath}.sourceId`, `Manifest target references unknown source ${target.sourceId}.`, target));
    }
    validateRequiredUrl(target.canonicalUrl, `${targetPath}.canonicalUrl`, issues, target);
  });
  return targetById;
}

function collectCoverageEntries(
  entries: SourceCoverageEntry[],
  sourceById: Map<string, PublicSource>,
  targetById: Map<string, IngestionTarget>,
  coveragePath: string,
  issues: IngestionValidationIssue[],
): Map<string, SourceCoverageEntry> {
  const coverageBySourceId = new Map<string, SourceCoverageEntry>();
  entries.forEach((entry, index) => {
    const entryPath = `${coveragePath}.sources[${index}]`;
    if (!isCoverageStatus(entry.status)) {
      issues.push(issue("invalid_coverage_status", "error", `${entryPath}.status`, `Invalid coverage status ${String(entry.status)}.`, { sourceId: entry.sourceId }));
    }
    if (coverageBySourceId.has(entry.sourceId)) {
      issues.push(issue("duplicate_source_coverage", "error", `${entryPath}.sourceId`, `Duplicate source coverage row for ${entry.sourceId}.`, { sourceId: entry.sourceId }));
    }
    coverageBySourceId.set(entry.sourceId, entry);
    if (!sourceById.has(entry.sourceId)) {
      issues.push(issue("unknown_coverage_source_id", "error", `${entryPath}.sourceId`, `Coverage references unknown source ${entry.sourceId}.`, { sourceId: entry.sourceId }));
    }
    validateOptionalUrl(entry.guideUrl, `${entryPath}.guideUrl`, issues, { sourceId: entry.sourceId });

    if (entry.status === "captured") {
      if (!entry.targetId) {
        issues.push(issue("captured_missing_target_id", "error", `${entryPath}.targetId`, "Captured coverage rows must reference a manifest target id.", { sourceId: entry.sourceId }));
        return;
      }
      const target = targetById.get(entry.targetId);
      if (!target) {
        issues.push(issue("stale_coverage_target_id", "error", `${entryPath}.targetId`, `Coverage target ${entry.targetId} is not present in manifest.`, { sourceId: entry.sourceId }));
        return;
      }
      if (target.sourceId !== entry.sourceId) {
        issues.push(issue("coverage_target_source_mismatch", "error", `${entryPath}.targetId`, `Coverage target ${entry.targetId} belongs to ${target.sourceId}.`, target));
      }
      if (target.sampleFixture === true) {
        issues.push(issue("sample_fixture_launch_coverage", "error", `${entryPath}.targetId`, `Sample fixture target ${entry.targetId} cannot count as launch coverage.`, target));
      }
    } else if (entry.targetId) {
      issues.push(issue("non_captured_target_id", "warning", `${entryPath}.targetId`, "Only captured coverage rows should reference manifest targets.", { sourceId: entry.sourceId }));
    }
  });
  return coverageBySourceId;
}

function collectRuntime(
  runSummary: IngestionRunSummary | undefined,
  targetById: Map<string, IngestionTarget>,
  runPath: string,
  issues: IngestionValidationIssue[],
): Map<string, SourceCoverageRuntimeStatus> {
  const runtimeByTargetId = new Map<string, SourceCoverageRuntimeStatus>();
  if (!runSummary) {
    return runtimeByTargetId;
  }

  for (const [index, target] of (runSummary.targets ?? []).entries()) {
    const targetPath = `${runPath}.targets[${index}].targetId`;
    if (!targetById.has(target.targetId)) {
      issues.push(issue("run_target_stale", "error", targetPath, `Run target ${target.targetId} is not present in manifest.`, target));
    }
    if (target.fetchStatus === "failed" || target.importStatus === "failed") {
      runtimeByTargetId.set(target.targetId, "failed");
    } else if (target.importStatus === "imported") {
      runtimeByTargetId.set(target.targetId, "captured");
    } else if (target.fetchStatus === "skipped" || target.importStatus === "skipped") {
      runtimeByTargetId.set(target.targetId, "skipped");
    } else {
      runtimeByTargetId.set(target.targetId, "pending");
    }
  }

  return runtimeByTargetId;
}

function runtimeStatusForTarget(targetId: string, runtimeByTargetId: Map<string, SourceCoverageRuntimeStatus>): SourceCoverageRuntimeStatus {
  return runtimeByTargetId.get(targetId) ?? "unknown";
}

async function readJson<T>(
  filePath: string,
  checkedFiles: Set<string>,
  issues: IngestionValidationIssue[],
  malformedCode: string,
  missingSeverity: IngestionValidationIssue["severity"],
  options: { missingIsIssue?: boolean } = {},
): Promise<LoadedJson<T>> {
  const displayPath = relativePath(filePath);
  checkedFiles.add(displayPath);
  if (!existsSync(filePath)) {
    if (options.missingIsIssue !== false) {
      issues.push(issue("missing_source_coverage_input", missingSeverity, displayPath, `Required coverage input is missing: ${displayPath}.`));
    }
    return { ok: false, missing: true };
  }
  try {
    const body = await readFile(filePath, "utf8");
    return { ok: true, missing: false, value: JSON.parse(body) as T };
  } catch (error) {
    issues.push(issue(malformedCode, missingSeverity, displayPath, sanitizeError(error)));
    return { ok: false, missing: false };
  }
}

function countCoverage(sources: SourceCoverageSourceReport[], issues: IngestionValidationIssue[]): SourceCoverageCounts {
  const counts: SourceCoverageCounts = {
    sources: sources.length,
    captured: 0,
    pending: 0,
    excluded: 0,
    manualOnly: 0,
    unavailable: 0,
    runtimeCaptured: sources.filter((source) => source.runtimeStatus === "captured").length,
    runtimeFailed: sources.filter((source) => source.runtimeStatus === "failed").length,
    runtimeUnknown: sources.filter((source) => source.runtimeStatus === "unknown").length,
    errors: issues.filter((item) => item.severity === "error").length,
    warnings: issues.filter((item) => item.severity === "warning").length,
  };

  for (const source of sources) {
    counts[STATUS_COUNT_KEYS[source.status]] += 1;
  }

  return counts;
}

function isCoverageStatus(status: unknown): status is SourceCoverageStatus {
  return status === "captured" || status === "pending" || status === "excluded" || status === "manual-only" || status === "unavailable";
}

function validateRequiredUrl(value: unknown, issuePath: string, issues: IngestionValidationIssue[], context: { sourceId?: string; artifactId?: string }): void {
  if (!stringValue(value)) {
    issues.push(issue("missing_url", "error", issuePath, "URL is required.", context));
    return;
  }
  validateOptionalUrl(value, issuePath, issues, context);
}

function validateOptionalUrl(value: unknown, issuePath: string, issues: IngestionValidationIssue[], context: { sourceId?: string; artifactId?: string }): void {
  const url = stringValue(value);
  if (!url) {
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      issues.push(issue("invalid_url", "error", issuePath, "URL must use http or https.", context));
    }
  } catch {
    issues.push(issue("invalid_url", "error", issuePath, `Malformed URL: ${url}.`, context));
  }
}

function issue(
  code: string,
  severity: IngestionValidationIssue["severity"],
  issuePath: string,
  message: string,
  context: { sourceId?: string; artifactId?: string } = {},
): IngestionValidationIssue {
  return {
    code,
    severity,
    path: relativePathLike(issuePath),
    message: message.replace(/\s+/g, " ").trim(),
    sourceId: context.sourceId,
    artifactId: context.artifactId,
  };
}

function compareIssues(left: IngestionValidationIssue, right: IngestionValidationIssue): number {
  return `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`);
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/g, "/");
}

function relativePathLike(issuePath: string): string {
  const [filePart, suffix] = splitJsonPath(issuePath);
  return `${relativePath(filePart)}${suffix}`;
}

function splitJsonPath(issuePath: string): [string, string] {
  const jsonMarker = issuePath.search(/\.(sources|targets|counts|phases|issues)\b/);
  if (jsonMarker === -1) {
    return [issuePath, ""];
  }
  return [issuePath.slice(0, jsonMarker), issuePath.slice(jsonMarker)];
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, " ").trim();
  }
  return String(error).replace(/\s+/g, " ").trim();
}
