import type { BulkReviewDiagnostics, BulkReviewIssuePhase, BulkReviewIssueStatus } from "../review/bulk";
import type { Position, Race, ReviewStatus, Source } from "./types";

export type SourceRaceCoverageStatus =
  | "reviewed-public-position"
  | "awaiting-review"
  | "no-public-position-found"
  | "pending-capture"
  | "manual-only"
  | "no-public-source-found"
  | "not-applicable";

export type SourceRaceCoverageIssueSeverity = "error" | "warning";

export interface SourceRaceCoverageIssue {
  code: string;
  severity: SourceRaceCoverageIssueSeverity;
  path: string;
  message: string;
  sourceId?: string;
  raceId?: string;
  raceSlug?: string;
  positionId?: string;
  value?: unknown;
  reasonCode?: string;
}

export interface SourceCoverageLedger {
  sources?: SourceCoverageLedgerRow[];
}

export interface SourceCoverageLedgerRow {
  sourceId?: unknown;
  status?: unknown;
  relevantRaceSlugs?: unknown;
  ballotUniverseGaps?: unknown;
  reason?: unknown;
  notes?: unknown;
}

export type SourceRaceUnpublishedDiagnosticStatus = BulkReviewIssueStatus;
export type SourceRaceUnpublishedDiagnosticPhase = BulkReviewIssuePhase;

export interface SourceRaceUnpublishedDiagnostic {
  status: SourceRaceUnpublishedDiagnosticStatus;
  phase: SourceRaceUnpublishedDiagnosticPhase;
  reasonCode: string;
  path: string;
  message: string;
  raceId: string;
  raceSlug: string;
  sourceId: string;
  entityId?: string;
  positionId?: string;
  evidenceId?: string;
  artifactId?: string;
  chunkId?: string;
}

export type PublicationDiagnosticsInput = Partial<Pick<BulkReviewDiagnostics, "issues">>;

export interface SourceRaceCoverageRow {
  raceId: string;
  raceSlug: string;
  raceTitle: string;
  sourceId: string;
  sourceSlug: string;
  sourceName: string;
  status: SourceRaceCoverageStatus;
  positionIds: string[];
  publicPositionIds: string[];
  reviewedPublicPositionIds: string[];
  ledgerStatus?: SourceCoverageLedgerStatus;
  ledgerPath?: string;
  reason?: string;
  notes?: string;
  unpublishedDiagnostics: SourceRaceUnpublishedDiagnostic[];
  unpublishedReasonCounts: Record<string, number>;
}

export interface SourceRaceCoverageReport {
  ok: boolean;
  counts: SourceRaceCoverageCounts;
  rows: SourceRaceCoverageRow[];
  issues: SourceRaceCoverageIssue[];
}

export interface SourceRaceCoverageCounts {
  sources: number;
  races: number;
  rows: number;
  statuses: Record<SourceRaceCoverageStatus, number>;
  errors: number;
  warnings: number;
}

export interface DurableSourceRaceCoverageReport {
  ok: boolean;
  generatedAt: string;
  checkedFiles: string[];
  counts: DurableSourceRaceCoverageCounts;
  byRace: DurableSourceRaceCoverageRace[];
  bySource: DurableSourceRaceCoverageSource[];
  issues: SourceRaceCoverageIssue[];
}

export interface DurableSourceRaceCoverageCounts {
  registeredSourceCount: number;
  raceCount: number;
  totalMatrixRows: number;
  reviewedPublicRows: number;
  awaitingReviewRows: number;
  pendingCaptureRows: number;
  manualOnlyRows: number;
  noPublicSourceFoundRows: number;
  noPublicPositionFoundRows: number;
  notApplicableRows: number;
  errors: number;
  warnings: number;
}

export interface DurableSourceRaceCoverageRace {
  raceId: string;
  raceSlug: string;
  raceTitle: string;
  counts: Record<SourceRaceCoverageStatus, number>;
  sources: SourceRaceCoverageRow[];
}

export interface DurableSourceRaceCoverageSource {
  sourceId: string;
  sourceSlug: string;
  sourceName: string;
  counts: Record<SourceRaceCoverageStatus, number>;
  races: Array<Pick<SourceRaceCoverageRow, "raceId" | "raceSlug" | "raceTitle" | "status" | "positionIds" | "publicPositionIds" | "reviewedPublicPositionIds" | "ledgerStatus" | "ledgerPath" | "reason" | "notes" | "unpublishedDiagnostics" | "unpublishedReasonCounts">>;
}

export interface BuildSourceRaceCoverageOptions {
  sources: Source[];
  races: Race[];
  sourceCoverage: SourceCoverageLedger;
  sourceCoveragePath?: string;
  publicationDiagnostics?: PublicationDiagnosticsInput;
  publicationDiagnosticsPath?: string;
}

type SourceCoverageLedgerStatus = "captured" | "pending" | "excluded" | "manual-only" | "unavailable";

type CoverageRelevance = "relevant" | "not-applicable" | "unknown";

interface NormalizedCoverageRow {
  sourceId: string;
  status?: SourceCoverageLedgerStatus;
  path: string;
  relevantRaceSlugs: string[];
  ballotUniverseGaps: string[];
  reason?: string;
  notes?: string;
}

const LEDGER_STATUSES = new Set<SourceCoverageLedgerStatus>(["captured", "pending", "excluded", "manual-only", "unavailable"]);
const REVIEWED_PUBLIC_STATUSES = new Set<ReviewStatus>(["verified", "published"]);
const COVERAGE_STATUSES: SourceRaceCoverageStatus[] = [
  "reviewed-public-position",
  "awaiting-review",
  "no-public-position-found",
  "pending-capture",
  "manual-only",
  "no-public-source-found",
  "not-applicable",
];
const PUBLICATION_DIAGNOSTIC_STATUSES = new Set<SourceRaceUnpublishedDiagnosticStatus>(["hidden", "rejected", "error"]);
const PUBLICATION_DIAGNOSTIC_PHASES = new Set<SourceRaceUnpublishedDiagnosticPhase>(["read", "validate", "prepare", "review", "publish", "load", "write"]);

export function buildSourceRaceCoverageReport(options: BuildSourceRaceCoverageOptions): SourceRaceCoverageReport {
  const coveragePath = options.sourceCoveragePath ?? "source-coverage.json";
  const issues: SourceRaceCoverageIssue[] = [];
  const raceSlugs = new Set(options.races.map((race) => race.slug));
  const racesById = new Map(options.races.map((race) => [race.id, race]));
  const racesBySlug = new Map(options.races.map((race) => [race.slug, race]));
  const sourcesById = collectSources(options.sources, issues);
  const coverageBySourceId = collectCoverageRows(options.sourceCoverage, coveragePath, sourcesById, raceSlugs, issues);
  const publicationDiagnosticsByRow = collectPublicationDiagnostics(
    options.publicationDiagnostics,
    options.publicationDiagnosticsPath ?? "publication-diagnostics.json",
    sourcesById,
    racesById,
    racesBySlug,
    issues,
  );

  for (const source of options.sources) {
    if (!coverageBySourceId.has(source.id)) {
      issues.push({
        code: "missing_coverage_row",
        severity: "error",
        path: `${coveragePath}.sources`,
        message: `Source ${source.id} is missing from source coverage ledger.`,
        sourceId: source.id,
      });
    }
  }

  const sortedRaces = [...options.races].sort((left, right) => left.slug.localeCompare(right.slug));
  const sortedSources = [...options.sources].sort((left, right) => left.id.localeCompare(right.id));
  const rows = sortedRaces.flatMap((race) =>
    sortedSources.map((source) => buildRow(race, source, coverageBySourceId.get(source.id), publicationDiagnosticsByRow.get(rowKey(race.id, source.id)) ?? [])),
  );

  const sortedIssues = issues.sort(compareIssues);
  const counts = countRows(options.sources.length, options.races.length, rows, sortedIssues);
  return { ok: counts.errors === 0, counts, rows, issues: sortedIssues };
}

export function emptySourceRaceCoverageStatusCounts(): Record<SourceRaceCoverageStatus, number> {
  return Object.fromEntries(COVERAGE_STATUSES.map((status) => [status, 0])) as Record<SourceRaceCoverageStatus, number>;
}

export function buildDurableSourceRaceCoverageReport(
  report: SourceRaceCoverageReport,
  options: { generatedAt: string; checkedFiles: string[] },
): DurableSourceRaceCoverageReport {
  const checkedFiles = [...new Set(options.checkedFiles)].sort();
  const byRace = buildByRace(report.rows);
  const bySource = buildBySource(report.rows);
  const issues = [...report.issues].sort(compareIssues);

  return {
    ok: report.ok,
    generatedAt: options.generatedAt,
    checkedFiles,
    counts: {
      registeredSourceCount: report.counts.sources,
      raceCount: report.counts.races,
      totalMatrixRows: report.counts.rows,
      reviewedPublicRows: report.counts.statuses["reviewed-public-position"],
      awaitingReviewRows: report.counts.statuses["awaiting-review"],
      pendingCaptureRows: report.counts.statuses["pending-capture"],
      manualOnlyRows: report.counts.statuses["manual-only"],
      noPublicSourceFoundRows: report.counts.statuses["no-public-source-found"],
      noPublicPositionFoundRows: report.counts.statuses["no-public-position-found"],
      notApplicableRows: report.counts.statuses["not-applicable"],
      errors: report.counts.errors,
      warnings: report.counts.warnings,
    },
    byRace,
    bySource,
    issues,
  };
}

function buildByRace(rows: SourceRaceCoverageRow[]): DurableSourceRaceCoverageRace[] {
  const rowsByRace = new Map<string, SourceRaceCoverageRow[]>();
  for (const row of rows) {
    const existing = rowsByRace.get(row.raceSlug) ?? [];
    existing.push(row);
    rowsByRace.set(row.raceSlug, existing);
  }

  return [...rowsByRace.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, raceRows]) => {
      const sortedRows = [...raceRows].sort(compareRowsBySource);
      const first = sortedRows[0];
      return {
        raceId: first?.raceId ?? "",
        raceSlug: first?.raceSlug ?? "",
        raceTitle: first?.raceTitle ?? "",
        counts: countStatuses(sortedRows),
        sources: sortedRows,
      };
    });
}

function buildBySource(rows: SourceRaceCoverageRow[]): DurableSourceRaceCoverageSource[] {
  const rowsBySource = new Map<string, SourceRaceCoverageRow[]>();
  for (const row of rows) {
    const existing = rowsBySource.get(row.sourceId) ?? [];
    existing.push(row);
    rowsBySource.set(row.sourceId, existing);
  }

  return [...rowsBySource.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, sourceRows]) => {
      const sortedRows = [...sourceRows].sort(compareRowsByRace);
      const first = sortedRows[0];
      return {
        sourceId: first?.sourceId ?? "",
        sourceSlug: first?.sourceSlug ?? "",
        sourceName: first?.sourceName ?? "",
        counts: countStatuses(sortedRows),
        races: sortedRows.map((row) => ({
          raceId: row.raceId,
          raceSlug: row.raceSlug,
          raceTitle: row.raceTitle,
          status: row.status,
          positionIds: row.positionIds,
          publicPositionIds: row.publicPositionIds,
          reviewedPublicPositionIds: row.reviewedPublicPositionIds,
          ledgerStatus: row.ledgerStatus,
          ledgerPath: row.ledgerPath,
          reason: row.reason,
          notes: row.notes,
          unpublishedDiagnostics: row.unpublishedDiagnostics,
          unpublishedReasonCounts: row.unpublishedReasonCounts,
        })),
      };
    });
}

function countStatuses(rows: SourceRaceCoverageRow[]): Record<SourceRaceCoverageStatus, number> {
  const counts = emptySourceRaceCoverageStatusCounts();
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function compareRowsBySource(left: SourceRaceCoverageRow, right: SourceRaceCoverageRow): number {
  return left.sourceId.localeCompare(right.sourceId);
}

function compareRowsByRace(left: SourceRaceCoverageRow, right: SourceRaceCoverageRow): number {
  return left.raceSlug.localeCompare(right.raceSlug);
}

function buildRow(race: Race, source: Source, coverage: NormalizedCoverageRow | undefined, unpublishedDiagnostics: SourceRaceUnpublishedDiagnostic[]): SourceRaceCoverageRow {
  const positions = race.positions.filter((position) => position.sourceId === source.id);
  const publicPositions = positions.filter((position) => position.publicationStatus === "public");
  const reviewedPublicPositions = publicPositions.filter(isReviewedEvidenceBackedPublicPosition);
  const status = deriveCoverageStatus(race, positions, reviewedPublicPositions, coverage);

  return {
    raceId: race.id,
    raceSlug: race.slug,
    raceTitle: race.title,
    sourceId: source.id,
    sourceSlug: source.slug,
    sourceName: source.name,
    status,
    positionIds: positions.map((position) => position.id),
    publicPositionIds: publicPositions.map((position) => position.id),
    reviewedPublicPositionIds: reviewedPublicPositions.map((position) => position.id),
    ledgerStatus: coverage?.status,
    ledgerPath: coverage?.path,
    reason: coverage?.reason,
    notes: coverage?.notes,
    unpublishedDiagnostics: [...unpublishedDiagnostics].sort(comparePublicationDiagnostics),
    unpublishedReasonCounts: countDiagnosticReasons(unpublishedDiagnostics),
  };
}

function deriveCoverageStatus(
  race: Race,
  positions: Position[],
  reviewedPublicPositions: Position[],
  coverage: NormalizedCoverageRow | undefined,
): SourceRaceCoverageStatus {
  if (reviewedPublicPositions.length > 0) return "reviewed-public-position";
  if (positions.length > 0) return "awaiting-review";

  const relevance = coverageRelevance(race, coverage);
  if (relevance === "not-applicable") return "not-applicable";

  switch (coverage?.status) {
    case "captured":
      return "no-public-position-found";
    case "pending":
      return "pending-capture";
    case "manual-only":
      return "manual-only";
    case "unavailable":
      return "no-public-source-found";
    case "excluded":
      return "not-applicable";
    default:
      return "no-public-source-found";
  }
}

function coverageRelevance(race: Race, coverage: NormalizedCoverageRow | undefined): CoverageRelevance {
  if (!coverage) return "unknown";
  if (coverage.relevantRaceSlugs.length > 0) return coverage.relevantRaceSlugs.includes(race.slug) ? "relevant" : "not-applicable";
  if (coverage.ballotUniverseGaps.length > 0) return coverage.ballotUniverseGaps.includes(race.slug) ? "relevant" : "not-applicable";
  return "unknown";
}

function isReviewedEvidenceBackedPublicPosition(position: Position): boolean {
  return position.publicationStatus === "public" && REVIEWED_PUBLIC_STATUSES.has(position.status) && position.evidenceIds.length > 0 && position.evidence.length > 0;
}

function collectSources(sources: Source[], issues: SourceRaceCoverageIssue[]): Map<string, Source> {
  const sourcesById = new Map<string, Source>();
  sources.forEach((source, index) => {
    const sourcePath = `sources[${index}]`;
    if (sourcesById.has(source.id)) {
      issues.push({
        code: "duplicate_registered_source",
        severity: "error",
        path: `${sourcePath}.id`,
        message: `Duplicate registered source id ${source.id}.`,
        sourceId: source.id,
      });
    }
    sourcesById.set(source.id, source);
  });
  return sourcesById;
}

function collectCoverageRows(
  sourceCoverage: SourceCoverageLedger,
  coveragePath: string,
  sourcesById: Map<string, Source>,
  raceSlugs: Set<string>,
  issues: SourceRaceCoverageIssue[],
): Map<string, NormalizedCoverageRow> {
  const rows = Array.isArray(sourceCoverage.sources) ? sourceCoverage.sources : [];
  if (!Array.isArray(sourceCoverage.sources)) {
    issues.push({ code: "invalid_coverage_sources", severity: "error", path: `${coveragePath}.sources`, message: "Source coverage ledger must contain a sources array." });
  }

  const coverageBySourceId = new Map<string, NormalizedCoverageRow>();
  rows.forEach((row, index) => {
    const rowPath = `${coveragePath}.sources[${index}]`;
    const sourceId = typeof row.sourceId === "string" ? row.sourceId : "";
    if (!sourceId) {
      issues.push({ code: "missing_coverage_source_id", severity: "error", path: `${rowPath}.sourceId`, message: "Coverage row must include a sourceId.", value: row.sourceId });
      return;
    }
    if (coverageBySourceId.has(sourceId)) {
      issues.push({ code: "duplicate_coverage_source_id", severity: "error", path: `${rowPath}.sourceId`, message: `Duplicate coverage source id ${sourceId}.`, sourceId });
    }
    if (!sourcesById.has(sourceId)) {
      issues.push({ code: "unknown_coverage_source_id", severity: "error", path: `${rowPath}.sourceId`, message: `Coverage row references unknown source ${sourceId}.`, sourceId });
    }

    const status = normalizeLedgerStatus(row.status, rowPath, sourceId, issues);
    const relevantRaceSlugs = normalizeRaceSlugArray(row.relevantRaceSlugs, `${rowPath}.relevantRaceSlugs`, sourceId, raceSlugs, issues);
    const ballotUniverseGaps = normalizeRaceSlugArray(row.ballotUniverseGaps, `${rowPath}.ballotUniverseGaps`, sourceId, raceSlugs, issues);
    coverageBySourceId.set(sourceId, {
      sourceId,
      status,
      path: rowPath,
      relevantRaceSlugs,
      ballotUniverseGaps,
      reason: typeof row.reason === "string" ? row.reason : undefined,
      notes: typeof row.notes === "string" ? row.notes : undefined,
    });
  });
  return coverageBySourceId;
}

function collectPublicationDiagnostics(
  publicationDiagnostics: PublicationDiagnosticsInput | undefined,
  diagnosticsPath: string,
  sourcesById: Map<string, Source>,
  racesById: Map<string, Race>,
  racesBySlug: Map<string, Race>,
  issues: SourceRaceCoverageIssue[],
): Map<string, SourceRaceUnpublishedDiagnostic[]> {
  const byRow = new Map<string, SourceRaceUnpublishedDiagnostic[]>();
  if (publicationDiagnostics === undefined) return byRow;
  if (!isRecord(publicationDiagnostics)) {
    issues.push({ code: "invalid_publication_diagnostics_shape", severity: "error", path: diagnosticsPath, message: "Publication diagnostics must be an object.", value: publicationDiagnostics });
    return byRow;
  }
  if (!Array.isArray(publicationDiagnostics.issues)) {
    issues.push({ code: "invalid_publication_diagnostics_issues", severity: "error", path: `${diagnosticsPath}.issues`, message: "Publication diagnostics must contain an issues array.", value: publicationDiagnostics.issues });
    return byRow;
  }

  const seen = new Set<string>();
  publicationDiagnostics.issues.forEach((raw, index) => {
    const issuePath = `${diagnosticsPath}.issues[${index}]`;
    if (!isRecord(raw)) {
      issues.push({ code: "invalid_publication_diagnostic", severity: "error", path: issuePath, message: "Publication diagnostic issue must be an object.", value: raw });
      return;
    }

    const sourceId = typeof raw.sourceId === "string" ? raw.sourceId : "";
    const raceId = typeof raw.raceId === "string" ? raw.raceId : "";
    const raceSlug = typeof raw.raceSlug === "string" ? raw.raceSlug : "";
    const reasonCode = typeof raw.reasonCode === "string" ? raw.reasonCode : "";
    const status = normalizePublicationDiagnosticStatus(raw.status, issuePath, sourceId, raceId || raceSlug, reasonCode, issues);
    const phase = normalizePublicationDiagnosticPhase(raw.phase, issuePath, sourceId, raceId || raceSlug, reasonCode, issues);

    if (!sourceId) {
      issues.push({ code: "missing_publication_diagnostic_source_id", severity: "error", path: `${issuePath}.sourceId`, message: "Publication diagnostic must include sourceId.", raceId, raceSlug, reasonCode, value: raw.sourceId });
    } else if (!sourcesById.has(sourceId)) {
      issues.push({ code: "unknown_publication_diagnostic_source", severity: "error", path: `${issuePath}.sourceId`, message: `Publication diagnostic references unknown source ${sourceId}.`, sourceId, raceId, raceSlug, reasonCode });
    }

    let race = raceId ? racesById.get(raceId) : undefined;
    const slugRace = raceSlug ? racesBySlug.get(raceSlug) : undefined;
    if (!race && slugRace) race = slugRace;
    if (!raceId && !raceSlug) {
      issues.push({ code: "missing_publication_diagnostic_race", severity: "error", path: `${issuePath}.raceId`, message: "Publication diagnostic must include raceId or raceSlug.", sourceId, reasonCode });
    } else if (!race) {
      issues.push({ code: "unknown_publication_diagnostic_race", severity: "error", path: `${issuePath}.${raceId ? "raceId" : "raceSlug"}`, message: `Publication diagnostic references unknown race ${raceId || raceSlug}.`, sourceId, raceId, raceSlug, reasonCode });
    } else if (raceId && raceSlug && race.slug !== raceSlug) {
      issues.push({ code: "mismatched_publication_diagnostic_race", severity: "error", path: `${issuePath}.raceSlug`, message: `Publication diagnostic raceSlug ${raceSlug} does not match raceId ${raceId}.`, sourceId, raceId, raceSlug, reasonCode });
    }

    if (!reasonCode) {
      issues.push({ code: "missing_publication_diagnostic_reason", severity: "error", path: `${issuePath}.reasonCode`, message: "Publication diagnostic must include reasonCode.", sourceId, raceId, raceSlug, value: raw.reasonCode });
    }

    if (!sourceId || !race || !reasonCode || !status || !phase || !sourcesById.has(sourceId)) return;

    const diagnostic: SourceRaceUnpublishedDiagnostic = {
      status,
      phase,
      reasonCode,
      path: typeof raw.path === "string" ? raw.path : issuePath,
      message: typeof raw.message === "string" ? raw.message : "",
      raceId: race.id,
      raceSlug: race.slug,
      sourceId,
    };
    if (typeof raw.entityId === "string") diagnostic.entityId = raw.entityId;
    if (typeof raw.positionId === "string") diagnostic.positionId = raw.positionId;
    if (typeof raw.evidenceId === "string") diagnostic.evidenceId = raw.evidenceId;
    if (typeof raw.artifactId === "string") diagnostic.artifactId = raw.artifactId;
    if (typeof raw.chunkId === "string") diagnostic.chunkId = raw.chunkId;
    const key = rowKey(race.id, sourceId);
    const duplicateKey = [key, diagnostic.status, diagnostic.phase, diagnostic.reasonCode, diagnostic.path, diagnostic.entityId ?? "", diagnostic.positionId ?? "", diagnostic.evidenceId ?? ""].join("|");
    if (seen.has(duplicateKey)) {
      issues.push({ code: "duplicate_publication_diagnostic", severity: "warning", path: issuePath, message: `Duplicate publication diagnostic for ${sourceId} in ${race.slug}.`, sourceId, raceId: race.id, raceSlug: race.slug, reasonCode });
    }
    seen.add(duplicateKey);
    const list = byRow.get(key) ?? [];
    list.push(diagnostic);
    byRow.set(key, list);
  });
  return byRow;
}

function normalizePublicationDiagnosticStatus(
  value: unknown,
  issuePath: string,
  sourceId: string,
  raceIdentifier: string,
  reasonCode: string,
  issues: SourceRaceCoverageIssue[],
): SourceRaceUnpublishedDiagnosticStatus | undefined {
  if (typeof value === "string" && PUBLICATION_DIAGNOSTIC_STATUSES.has(value as SourceRaceUnpublishedDiagnosticStatus)) return value as SourceRaceUnpublishedDiagnosticStatus;
  issues.push({ code: "invalid_publication_diagnostic_status", severity: "error", path: `${issuePath}.status`, message: `Publication diagnostic has invalid status ${JSON.stringify(value)}.`, sourceId, raceId: raceIdentifier, reasonCode, value });
  return undefined;
}

function normalizePublicationDiagnosticPhase(
  value: unknown,
  issuePath: string,
  sourceId: string,
  raceIdentifier: string,
  reasonCode: string,
  issues: SourceRaceCoverageIssue[],
): SourceRaceUnpublishedDiagnosticPhase | undefined {
  if (typeof value === "string" && PUBLICATION_DIAGNOSTIC_PHASES.has(value as SourceRaceUnpublishedDiagnosticPhase)) return value as SourceRaceUnpublishedDiagnosticPhase;
  issues.push({ code: "invalid_publication_diagnostic_phase", severity: "error", path: `${issuePath}.phase`, message: `Publication diagnostic has invalid phase ${JSON.stringify(value)}.`, sourceId, raceId: raceIdentifier, reasonCode, value });
  return undefined;
}

function countDiagnosticReasons(diagnostics: SourceRaceUnpublishedDiagnostic[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const diagnostic of diagnostics) counts[diagnostic.reasonCode] = (counts[diagnostic.reasonCode] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function comparePublicationDiagnostics(left: SourceRaceUnpublishedDiagnostic, right: SourceRaceUnpublishedDiagnostic): number {
  return left.reasonCode.localeCompare(right.reasonCode) || left.path.localeCompare(right.path) || left.status.localeCompare(right.status);
}

function rowKey(raceId: string, sourceId: string): string {
  return `${raceId}::${sourceId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLedgerStatus(
  value: unknown,
  rowPath: string,
  sourceId: string,
  issues: SourceRaceCoverageIssue[],
): SourceCoverageLedgerStatus | undefined {
  if (typeof value === "string" && LEDGER_STATUSES.has(value as SourceCoverageLedgerStatus)) return value as SourceCoverageLedgerStatus;
  issues.push({
    code: "invalid_coverage_status",
    severity: "error",
    path: `${rowPath}.status`,
    message: `Coverage row ${sourceId} has invalid status ${JSON.stringify(value)}.`,
    sourceId,
    value,
  });
  return undefined;
}

function normalizeRaceSlugArray(
  value: unknown,
  valuePath: string,
  sourceId: string,
  raceSlugs: Set<string>,
  issues: SourceRaceCoverageIssue[],
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push({ code: "invalid_race_slug_array", severity: "error", path: valuePath, message: "Coverage race metadata must be an array of race slugs.", sourceId, value });
    return [];
  }
  const slugs: string[] = [];
  value.forEach((item, index) => {
    const itemPath = `${valuePath}[${index}]`;
    if (typeof item !== "string") {
      issues.push({ code: "invalid_race_slug", severity: "error", path: itemPath, message: "Coverage race metadata values must be race slug strings.", sourceId, value: item });
      return;
    }
    slugs.push(item);
    if (!raceSlugs.has(item)) {
      issues.push({ code: "unknown_race_slug", severity: "error", path: itemPath, message: `Coverage metadata references unknown race slug ${item}.`, sourceId, raceSlug: item });
    }
  });
  return slugs;
}

function countRows(sourceCount: number, raceCount: number, rows: SourceRaceCoverageRow[], issues: SourceRaceCoverageIssue[]): SourceRaceCoverageCounts {
  const statuses = emptySourceRaceCoverageStatusCounts();
  for (const row of rows) statuses[row.status] += 1;
  return {
    sources: sourceCount,
    races: raceCount,
    rows: rows.length,
    statuses,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
  };
}

function compareIssues(left: SourceRaceCoverageIssue, right: SourceRaceCoverageIssue): number {
  return left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || (left.sourceId ?? "").localeCompare(right.sourceId ?? "");
}
