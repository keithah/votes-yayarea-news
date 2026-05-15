import { promises as fs } from "node:fs";
import path from "node:path";
import { mergeRace } from "../data/loaders";
import { loadPublicData } from "../data/validate";
import type { Entity, Evidence, Position, PositionKind, PublicationStatus, Race, ReviewStatus, Source } from "../data/types";
import type { SourceCoverageStatus } from "../ingestion/sourceCoverage";

export type ReviewedPositionCoverageSeverity = "error" | "warning";

export interface ReviewedPositionCoverageIssue {
  code: string;
  severity: ReviewedPositionCoverageSeverity;
  path: string;
  message: string;
  raceId?: string;
  raceSlug?: string;
  sourceId?: string;
  entityId?: string;
  positionId?: string;
  evidenceId?: string;
}

export interface ReviewedPositionCoverageReport {
  ok: boolean;
  generatedAt: string;
  checkedFiles: string[];
  counts: ReviewedPositionCoverageCounts;
  byRace: ReviewedPositionRaceCoverage[];
  bySource: ReviewedPositionSourceCoverage[];
  issues: ReviewedPositionCoverageIssue[];
}

export interface ReviewedPositionCoverageCounts {
  races: number;
  publicRaces: number;
  positions: number;
  publicPositions: number;
  publicEvidence: number;
  reviewedPublicPositions: number;
  evidenceBackedPublicPositions: number;
  provenanceCompleteEvidence: number;
  provenancePartialEvidence: number;
  provenanceAbsentEvidence: number;
  endorse: number;
  oppose: number;
  rank: number;
  noPosition: number;
  informational: number;
  errors: number;
  warnings: number;
}

export interface ReviewedPositionRaceCoverage {
  raceId: string;
  raceSlug: string;
  title: string;
  publicationStatus: PublicationStatus;
  status: ReviewStatus;
  positions: number;
  publicPositions: number;
  publicEvidence: number;
  byKind: Record<PositionKind, number>;
  byReviewStatus: Record<ReviewStatus, number>;
  byPublicationStatus: Record<PublicationStatus, number>;
  provenance: ProvenanceCounts;
}

export interface ReviewedPositionSourceCoverage {
  sourceId: string;
  name: string;
  coverageStatus: SourceCoverageStatus | "missing";
  runtimeStatus?: string;
  positions: number;
  publicPositions: number;
  publicEvidence: number;
  publicRecommendationPositions: number;
  provenance: ProvenanceCounts;
}

export interface BuildReviewedPositionCoverageOptions {
  publicDir?: string;
  overridesDir?: string;
  sourceCoveragePath?: string;
  ingestedCoveragePath?: string;
  ingestedValidationPath?: string;
  outPath?: string;
  now?: () => Date;
}

interface SourceCoverageJson {
  sources?: Array<{ sourceId?: unknown; status?: unknown }>;
}

interface IngestedCoverageJson {
  checkedFiles?: unknown;
  sources?: Array<{ sourceId?: unknown; status?: unknown; runtimeStatus?: unknown }>;
  issues?: unknown;
}

interface IngestedValidationJson {
  checkedFiles?: unknown;
  issues?: unknown;
}

interface SourceCoverageState {
  status: SourceCoverageStatus | "missing";
  runtimeStatus?: string;
}

const DEFAULT_PUBLIC_DIR = path.join(process.cwd(), "data", "public");
const DEFAULT_OVERRIDES_DIR = path.join(process.cwd(), "manual", "overrides");
const DEFAULT_SOURCE_COVERAGE = path.join(process.cwd(), "data", "ingestion", "source-coverage.json");
const DEFAULT_INGESTED_COVERAGE = path.join(process.cwd(), "data", "ingested", "coverage", "latest.json");
const DEFAULT_INGESTED_VALIDATION = path.join(process.cwd(), "data", "ingested", "validation", "latest.json");
const PUBLIC_REVIEW_STATUSES = new Set<ReviewStatus>(["verified", "published"]);
const RECOMMENDATION_KINDS = new Set<PositionKind>(["endorse", "oppose", "no-position"]);
const POSITION_KINDS: PositionKind[] = ["endorse", "oppose", "rank", "no-position", "informational"];
const REVIEW_STATUSES: ReviewStatus[] = ["draft", "reviewed", "verified", "published", "rejected"];
const PUBLICATION_STATUSES: PublicationStatus[] = ["hidden", "public", "archived"];

export async function buildReviewedPositionCoverageReport(options: BuildReviewedPositionCoverageOptions = {}): Promise<ReviewedPositionCoverageReport> {
  const publicDir = options.publicDir ?? DEFAULT_PUBLIC_DIR;
  const overridesDir = options.overridesDir ?? DEFAULT_OVERRIDES_DIR;
  const sourceCoveragePath = options.sourceCoveragePath ?? DEFAULT_SOURCE_COVERAGE;
  const ingestedCoveragePath = options.ingestedCoveragePath ?? DEFAULT_INGESTED_COVERAGE;
  const ingestedValidationPath = options.ingestedValidationPath ?? DEFAULT_INGESTED_VALIDATION;
  const checkedFiles = new Set<string>();
  const issues: ReviewedPositionCoverageIssue[] = [];

  const loadedPublic = await loadPublicData(publicDir);
  loadedPublic.checkedFiles.forEach((file) => checkedFiles.add(relative(file)));
  for (const loadIssue of loadedPublic.issues) {
    issues.push(issue("public_data_load_issue", "error", loadIssue.path, loadIssue.message));
  }

  const sourceCoverage = await readOptionalJson<SourceCoverageJson>(sourceCoveragePath, checkedFiles, issues, "source_coverage_json_malformed");
  const ingestedCoverage = await readOptionalJson<IngestedCoverageJson>(ingestedCoveragePath, checkedFiles, issues, "ingested_coverage_json_malformed");
  const ingestedValidation = await readOptionalJson<IngestedValidationJson>(ingestedValidationPath, checkedFiles, issues, "ingested_validation_json_malformed");
  collectCheckedFiles(ingestedCoverage?.checkedFiles, checkedFiles);
  collectCheckedFiles(ingestedValidation?.checkedFiles, checkedFiles);
  collectExternalIssues(ingestedCoverage?.issues, ingestedCoveragePath, "ingested_coverage_issue", issues);
  collectExternalIssues(ingestedValidation?.issues, ingestedValidationPath, "ingested_validation_issue", issues);

  const sourceCoverageById = collectSourceCoverage(sourceCoverage, ingestedCoverage);
  const sourcesById = new Map(loadedPublic.repository.sources.map((source) => [source.id, source]));
  const entitiesById = new Map(loadedPublic.repository.entities.map((entity) => [entity.id, entity]));

  const races: Race[] = [];
  for (const canonicalRace of loadedPublic.repository.races) {
    const racePath = path.join(publicDir, "races", `${canonicalRace.slug}.json`);
    const overridePath = path.join(overridesDir, "races", `${canonicalRace.slug}.json`);
    checkedFiles.add(relative(racePath));
    const override = await readOptionalRaceOverride(overridePath, checkedFiles, issues);
    races.push(override ? mergeRace(canonicalRace, override, canonicalRace.slug, relative(overridePath)) : structuredClone(canonicalRace));
  }

  const byRace: ReviewedPositionRaceCoverage[] = [];
  const sourceAccumulators = new Map<string, ReviewedPositionSourceCoverage>();
  const totals: ReviewedPositionCoverageCounts = {
    races: races.length,
    publicRaces: 0,
    positions: 0,
    publicPositions: 0,
    publicEvidence: 0,
    reviewedPublicPositions: 0,
    evidenceBackedPublicPositions: 0,
    provenanceCompleteEvidence: 0,
    provenancePartialEvidence: 0,
    provenanceAbsentEvidence: 0,
    endorse: 0,
    oppose: 0,
    rank: 0,
    noPosition: 0,
    informational: 0,
    errors: 0,
    warnings: 0,
  };

  races.sort((left, right) => left.slug.localeCompare(right.slug)).forEach((race) => {
    const racePath = path.join(publicDir, "races", `${race.slug}.json`);
    const raceCoverage = emptyRaceCoverage(race);
    if (race.publicationStatus === "public") totals.publicRaces += 1;
    totals.positions += race.positions.length;

    race.positions.forEach((position, positionIndex) => {
      if (!isPublicPosition(position)) return;
      const positionPath = `${relative(racePath)}.race.positions[${positionIndex}]`;
      const source = sourcesById.get(position.sourceId);
      const entity = entitiesById.get(position.entityId);
      const sourceState = sourceCoverageById.get(position.sourceId) ?? { status: "missing" as const };
      const sourceCoverage = sourceAccumulator(sourceAccumulators, position.sourceId, source, sourceState);

      totals.publicPositions += 1;
      totals[positionKindCountKey(position.kind)] += 1;
      if (PUBLIC_REVIEW_STATUSES.has(position.status)) totals.reviewedPublicPositions += 1;
      if (position.evidence.length > 0 && position.evidenceIds.length > 0) totals.evidenceBackedPublicPositions += 1;

      raceCoverage.positions += 1;
      raceCoverage.publicPositions += 1;
      raceCoverage.byKind[position.kind] += 1;
      raceCoverage.byReviewStatus[position.status] += 1;
      raceCoverage.byPublicationStatus[position.publicationStatus] += 1;
      sourceCoverage.positions += 1;
      sourceCoverage.publicPositions += 1;
      if (RECOMMENDATION_KINDS.has(position.kind)) sourceCoverage.publicRecommendationPositions += 1;

      if (position.evidence.length === 0 || position.evidenceIds.length === 0) {
        issues.push(issue("public_position_missing_evidence", "error", `${positionPath}.evidence`, "Public positions must include direct evidence before publication.", position, race));
      }
      if (!PUBLIC_REVIEW_STATUSES.has(position.status)) {
        issues.push(issue("public_position_not_reviewed", "error", `${positionPath}.status`, "Public positions must be verified or published.", position, race));
      }
      if (RECOMMENDATION_KINDS.has(position.kind) && sourceState.status !== "captured") {
        issues.push(issue("unsupported_public_recommendation_source", "error", `${positionPath}.sourceId`, `Public ${position.kind} records require captured source coverage; source coverage is ${sourceState.status}.`, position, race));
      }
      if (hasSampleLeakage(source, entity, race, position)) {
        issues.push(issue("sample_mayor_leakage", "error", positionPath, "Sample Mayor source/entity data must not leak into public reviewed positions.", position, race));
      }

      position.evidence.forEach((evidence, evidenceIndex) => {
        const evidencePath = `${positionPath}.evidence[${evidenceIndex}]`;
        totals.publicEvidence += 1;
        raceCoverage.publicEvidence += 1;
        sourceCoverage.publicEvidence += 1;
        applyProvenanceCounts(evidence, totals, raceCoverage.provenance, sourceCoverage.provenance);
        if (hasPartialProvenance(evidence)) {
          issues.push(issue("partial_evidence_provenance", "error", evidence.artifactId ? `${evidencePath}.chunkId` : `${evidencePath}.artifactId`, "Evidence with artifact or chunk provenance must include both artifactId and chunkId.", position, race, evidence));
        }
        if (RECOMMENDATION_KINDS.has(position.kind) && !evidence.quote?.trim()) {
          issues.push(issue("public_recommendation_missing_quote", "error", `${evidencePath}.quote`, "Public recommendation-style evidence must include a quote.", position, race, evidence));
        }
      });
    });

    byRace.push(raceCoverage);
  });

  const sortedIssues = issues.sort(compareIssues);
  totals.errors = sortedIssues.filter((item) => item.severity === "error").length;
  totals.warnings = sortedIssues.filter((item) => item.severity === "warning").length;
  return {
    ok: totals.errors === 0,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    checkedFiles: Array.from(checkedFiles).sort(),
    counts: totals,
    byRace,
    bySource: Array.from(sourceAccumulators.values()).sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    issues: sortedIssues,
  };
}

export async function writeReviewedPositionCoverageReport(reportPath: string, report: ReviewedPositionCoverageReport): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function emptyRaceCoverage(race: Race): ReviewedPositionRaceCoverage {
  return {
    raceId: race.id,
    raceSlug: race.slug,
    title: race.title,
    publicationStatus: race.publicationStatus,
    status: race.status,
    positions: race.positions.length,
    publicPositions: 0,
    publicEvidence: 0,
    byKind: zeroPositionKinds(),
    byReviewStatus: zeroReviewStatuses(),
    byPublicationStatus: zeroPublicationStatuses(),
    provenance: zeroProvenance(),
  };
}

function sourceAccumulator(accumulators: Map<string, ReviewedPositionSourceCoverage>, sourceId: string, source: Source | undefined, state: SourceCoverageState): ReviewedPositionSourceCoverage {
  const existing = accumulators.get(sourceId);
  if (existing) return existing;
  const created: ReviewedPositionSourceCoverage = {
    sourceId,
    name: source?.name ?? sourceId,
    coverageStatus: state.status,
    runtimeStatus: state.runtimeStatus,
    positions: 0,
    publicPositions: 0,
    publicEvidence: 0,
    publicRecommendationPositions: 0,
    provenance: zeroProvenance(),
  };
  accumulators.set(sourceId, created);
  return created;
}

interface ProvenanceCounts {
  complete: number;
  partial: number;
  absent: number;
}

function zeroProvenance(): ProvenanceCounts {
  return { complete: 0, partial: 0, absent: 0 };
}

function applyProvenanceCounts(evidence: Evidence, totals: ReviewedPositionCoverageCounts, race: ProvenanceCounts, source: ProvenanceCounts): void {
  const bucket = hasCompleteProvenance(evidence) ? "complete" : hasPartialProvenance(evidence) ? "partial" : "absent";
  race[bucket] += 1;
  source[bucket] += 1;
  if (bucket === "complete") totals.provenanceCompleteEvidence += 1;
  else if (bucket === "partial") totals.provenancePartialEvidence += 1;
  else totals.provenanceAbsentEvidence += 1;
}

function collectSourceCoverage(sourceCoverage: SourceCoverageJson | null, ingestedCoverage: IngestedCoverageJson | null): Map<string, SourceCoverageState> {
  const states = new Map<string, SourceCoverageState>();
  for (const source of sourceCoverage?.sources ?? []) {
    if (typeof source.sourceId !== "string") continue;
    states.set(source.sourceId, { status: isSourceCoverageStatus(source.status) ? source.status : "missing" });
  }
  for (const source of ingestedCoverage?.sources ?? []) {
    if (typeof source.sourceId !== "string") continue;
    const existing = states.get(source.sourceId) ?? { status: "missing" as const };
    states.set(source.sourceId, {
      status: isSourceCoverageStatus(source.status) ? source.status : existing.status,
      runtimeStatus: typeof source.runtimeStatus === "string" ? source.runtimeStatus : existing.runtimeStatus,
    });
  }
  return states;
}

async function readOptionalJson<T>(filePath: string, checkedFiles: Set<string>, issues: ReviewedPositionCoverageIssue[], malformedCode: string): Promise<T | null> {
  checkedFiles.add(relative(filePath));
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      issues.push(issue("coverage_input_missing", "warning", relative(filePath), "Optional coverage input is missing; report will continue with available data."));
      return null;
    }
    issues.push(issue(malformedCode, "error", relative(filePath), `Unable to read coverage input: ${formatError(error)}`));
    return null;
  }
}

async function readOptionalRaceOverride(filePath: string, checkedFiles: Set<string>, issues: ReviewedPositionCoverageIssue[]): Promise<Partial<Race> | null> {
  checkedFiles.add(relative(filePath));
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.race)) {
      issues.push(issue("override_json_invalid_shape", "error", relative(filePath), "Race override must contain a top-level race object."));
      return null;
    }
    return parsed.race as Partial<Race>;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    issues.push(issue("override_json_malformed", "error", relative(filePath), `Unable to read race override: ${formatError(error)}`));
    return null;
  }
}

function collectCheckedFiles(value: unknown, checkedFiles: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") checkedFiles.add(relative(item));
  }
}

function collectExternalIssues(value: unknown, inputPath: string, code: string, issues: ReviewedPositionCoverageIssue[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    const severity = item.severity === "warning" ? "warning" : "error";
    const pathValue = typeof item.path === "string" ? item.path : `${relative(inputPath)}.issues[${index}]`;
    const message = typeof item.message === "string" ? item.message : "Upstream diagnostic issue surfaced in reviewed-position coverage.";
    issues.push(issue(code, severity, pathValue, message));
  });
}

function issue(code: string, severity: ReviewedPositionCoverageSeverity, issuePath: string, message: string, position?: Position, race?: Race, evidence?: Evidence): ReviewedPositionCoverageIssue {
  return {
    code,
    severity,
    path: relative(issuePath),
    message: sanitize(message),
    raceId: race?.id ?? position?.raceId ?? evidence?.raceId,
    raceSlug: race?.slug,
    sourceId: position?.sourceId ?? evidence?.sourceId,
    entityId: position?.entityId ?? evidence?.entityId,
    positionId: position?.id,
    evidenceId: evidence?.id,
  };
}

function isPublicPosition(position: Position): boolean {
  return position.publicationStatus === "public";
}

function hasCompleteProvenance(evidence: Evidence): boolean {
  return Boolean(evidence.artifactId && evidence.chunkId);
}

function hasPartialProvenance(evidence: Evidence): boolean {
  return Boolean(evidence.artifactId) !== Boolean(evidence.chunkId);
}

function hasSampleLeakage(source: Source | undefined, entity: Entity | undefined, race: Race, position: Position): boolean {
  if (source?.sampleFixture || entity?.sampleFixture || race.sampleFixture) return true;
  const haystack = [source?.id, source?.slug, source?.name, entity?.id, entity?.slug, entity?.name, race.id, race.slug, position.id, position.label].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes("mayor") && haystack.includes("sample");
}

function zeroPositionKinds(): Record<PositionKind, number> {
  return Object.fromEntries(POSITION_KINDS.map((kind) => [kind, 0])) as Record<PositionKind, number>;
}

function zeroReviewStatuses(): Record<ReviewStatus, number> {
  return Object.fromEntries(REVIEW_STATUSES.map((status) => [status, 0])) as Record<ReviewStatus, number>;
}

function zeroPublicationStatuses(): Record<PublicationStatus, number> {
  return Object.fromEntries(PUBLICATION_STATUSES.map((status) => [status, 0])) as Record<PublicationStatus, number>;
}

function positionKindCountKey(kind: PositionKind): keyof Pick<ReviewedPositionCoverageCounts, "endorse" | "oppose" | "rank" | "noPosition" | "informational"> {
  if (kind === "no-position") return "noPosition";
  return kind;
}

function isSourceCoverageStatus(value: unknown): value is SourceCoverageStatus {
  return value === "captured" || value === "pending" || value === "excluded" || value === "manual-only" || value === "unavailable";
}

function compareIssues(left: ReviewedPositionCoverageIssue, right: ReviewedPositionCoverageIssue): number {
  return `${left.severity}:${left.path}:${left.code}`.localeCompare(`${right.severity}:${right.path}:${right.code}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitize(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/\s+/g, " ").trim();
}

function relative(filePath: string): string {
  return path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) || filePath : filePath;
}
