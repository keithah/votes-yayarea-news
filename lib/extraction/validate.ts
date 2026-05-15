import type { PublicDataRepository, Race } from "../data/types";
import type { ArtifactChunk, IngestedArtifact } from "../ingestion/types";
import type {
  DraftEvidence,
  DraftPosition,
  ExtractionDraft,
  ExtractionReviewStatus,
  ExtractionValidationContext,
  ExtractionValidationIssue,
  ExtractionValidationReport,
  ExtractionRunCounts,
} from "./types";

interface IssueContext {
  sourceId?: unknown;
  artifactId?: unknown;
  chunkId?: unknown;
  raceId?: unknown;
  entityId?: unknown;
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POSITION_KINDS = new Set(["endorse", "oppose", "rank", "no-position", "informational"]);
const EVIDENCE_KINDS = new Set(["quote", "snippet", "summary", "link"]);
const PUBLICATION_STATUSES = new Set(["hidden", "public", "archived"]);
const REVIEW_STATUSES = new Set<ExtractionReviewStatus>(["generated", "needs-review", "reviewed", "verified", "published", "rejected"]);
const REVIEWED_FOR_PUBLIC = new Set<ExtractionReviewStatus>(["reviewed", "verified", "published"]);

export function validateExtractionDraft(input: unknown, context: ExtractionValidationContext): ExtractionValidationReport {
  const issues: ExtractionValidationIssue[] = [];
  const draft = coerceDraft(input, issues);
  const positions = Array.isArray(draft?.positions) ? draft.positions : [];
  const evidence = Array.isArray(draft?.evidence) ? draft.evidence : [];

  const sourceIds = new Set(context.publicData.sources.map((source) => source.id));
  const entityIds = new Set(context.publicData.entities.map((entity) => entity.id));
  const racesById = new Map(context.publicData.races.map((race) => [race.id, race]));
  const artifactsById = new Map(context.artifacts.map((artifact) => [artifact.id, artifact]));
  const chunksById = new Map(context.chunks.map((chunk) => [chunk.id, chunk]));
  const evidenceById = new Map<string, DraftEvidence>();

  validateDuplicateIds(positions, "positions", issues);
  validateDuplicateIds(evidence, "evidence", issues);

  evidence.forEach((item, index) => {
    if (!isRecord(item)) {
      addIssue(issues, "invalid_shape", "error", `evidence[${index}]`, "Evidence must be an object.");
      return;
    }
    validateEvidence(item as DraftEvidence, `evidence[${index}]`, sourceIds, entityIds, racesById, artifactsById, chunksById, issues);
    if (typeof item.id === "string" && !evidenceById.has(item.id)) evidenceById.set(item.id, item as DraftEvidence);
  });

  positions.forEach((item, index) => {
    if (!isRecord(item)) {
      addIssue(issues, "invalid_shape", "error", `positions[${index}]`, "Position must be an object.");
      return;
    }
    validatePosition(item as DraftPosition, `positions[${index}]`, sourceIds, entityIds, racesById, evidenceById, issues);
  });

  const counts = countValidation(positions.length, evidence.length, issues);
  return {
    ok: counts.errors === 0,
    checkedFiles: context.checkedFiles ?? [],
    counts,
    issues: issues.sort(compareIssues),
  };
}

function coerceDraft(input: unknown, issues: ExtractionValidationIssue[]): ExtractionDraft | undefined {
  if (!isRecord(input)) {
    addIssue(issues, "invalid_shape", "error", "$", "Extraction draft must be an object.");
    return undefined;
  }
  if (input.version !== 1) addIssue(issues, "unsupported_version", "error", "version", "Extraction draft version must be 1.");
  requireString(input.runId, "runId", "missing_run_id", issues);
  if (!isRecord(input.provider)) {
    addIssue(issues, "invalid_provider", "error", "provider", "Provider metadata must be an object.");
  } else {
    requireString(input.provider.provider, "provider.provider", "missing_provider", issues);
    requireString(input.provider.model, "provider.model", "missing_model", issues);
  }
  if (!Array.isArray(input.positions)) addIssue(issues, "invalid_shape", "error", "positions", "positions must be an array.");
  if (!Array.isArray(input.evidence)) addIssue(issues, "invalid_shape", "error", "evidence", "evidence must be an array.");
  return input as unknown as ExtractionDraft;
}

function validatePosition(
  position: DraftPosition,
  basePath: string,
  sourceIds: Set<string>,
  entityIds: Set<string>,
  racesById: Map<string, Race>,
  evidenceById: Map<string, DraftEvidence>,
  issues: ExtractionValidationIssue[],
): void {
  requireKebab(position.id, `${basePath}.id`, "invalid_position_id", issues, position);
  requireReference(position.raceId, `${basePath}.raceId`, racesById, "Race", "unknown_race_id", issues, position);
  requireReference(position.sourceId, `${basePath}.sourceId`, sourceIds, "Source", "unknown_source_id", issues, position);
  requireReference(position.entityId, `${basePath}.entityId`, entityIds, "Entity", "unknown_entity_id", issues, position);
  requireEnum(position.kind, POSITION_KINDS, `${basePath}.kind`, "unsupported_position_kind", issues, position);
  requireEnum(position.reviewStatus, REVIEW_STATUSES, `${basePath}.reviewStatus`, "unsupported_review_status", issues, position);
  requireEnum(position.publicationStatus, PUBLICATION_STATUSES, `${basePath}.publicationStatus`, "unsupported_publication_status", issues, position);
  requireString(position.label, `${basePath}.label`, "missing_label", issues, position);

  const race = typeof position.raceId === "string" ? racesById.get(position.raceId) : undefined;
  if (race) {
    if (typeof position.sourceId === "string" && !race.sourceIds.includes(position.sourceId)) {
      addIssue(issues, "source_not_in_race", "error", `${basePath}.sourceId`, `Source '${position.sourceId}' is not allowed for race '${race.id}'.`, position);
    }
    if (typeof position.entityId === "string" && !race.entityIds.includes(position.entityId)) {
      addIssue(issues, "entity_not_in_race", "error", `${basePath}.entityId`, `Entity '${position.entityId}' is not in race '${race.id}'.`, position);
    }
  }

  if (!Array.isArray(position.evidenceIds)) {
    addIssue(issues, "invalid_shape", "error", `${basePath}.evidenceIds`, "evidenceIds must be an array.", position);
  } else {
    position.evidenceIds.forEach((evidenceId, index) => {
      if (!requireString(evidenceId, `${basePath}.evidenceIds[${index}]`, "missing_evidence_id", issues, position)) return;
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        addIssue(issues, "missing_evidence_reference", "error", `${basePath}.evidenceIds[${index}]`, `Evidence '${evidenceId}' does not exist.`, position);
        return;
      }
      if (evidence.positionId !== position.id) addIssue(issues, "evidence_position_mismatch", "error", `${basePath}.evidenceIds[${index}]`, `Evidence '${evidenceId}' belongs to position '${evidence.positionId}'.`, evidence);
      if (evidence.raceId !== position.raceId) addIssue(issues, "evidence_race_mismatch", "error", `${basePath}.evidenceIds[${index}]`, `Evidence '${evidenceId}' raceId must match position raceId.`, evidence);
      if (evidence.sourceId !== position.sourceId) addIssue(issues, "evidence_source_mismatch", "error", `${basePath}.evidenceIds[${index}]`, `Evidence '${evidenceId}' sourceId must match position sourceId.`, evidence);
      if (evidence.entityId && evidence.entityId !== position.entityId) addIssue(issues, "evidence_entity_mismatch", "error", `${basePath}.evidenceIds[${index}]`, `Evidence '${evidenceId}' entityId must match position entityId.`, evidence);
    });
  }

  if ((position.publicReady === true || position.publicationStatus === "public") && (position.evidenceIds?.length ?? 0) === 0) {
    addIssue(issues, "missing_evidence", "error", `${basePath}.evidenceIds`, "Public-ready positions must include at least one evidence reference.", position);
  }
  if (position.publicationStatus === "public" && !REVIEWED_FOR_PUBLIC.has(position.reviewStatus)) {
    addIssue(issues, "unreviewed_publication", "error", `${basePath}.publicationStatus`, "Generated positions cannot mark themselves public before review.", position);
  }
}

function validateEvidence(
  evidence: DraftEvidence,
  basePath: string,
  sourceIds: Set<string>,
  entityIds: Set<string>,
  racesById: Map<string, Race>,
  artifactsById: Map<string, IngestedArtifact>,
  chunksById: Map<string, ArtifactChunk>,
  issues: ExtractionValidationIssue[],
): void {
  requireKebab(evidence.id, `${basePath}.id`, "invalid_evidence_id", issues, evidence);
  requireKebab(evidence.positionId, `${basePath}.positionId`, "invalid_position_id", issues, evidence);
  requireReference(evidence.raceId, `${basePath}.raceId`, racesById, "Race", "unknown_race_id", issues, evidence);
  requireReference(evidence.sourceId, `${basePath}.sourceId`, sourceIds, "Source", "unknown_source_id", issues, evidence);
  if (evidence.entityId !== undefined) requireReference(evidence.entityId, `${basePath}.entityId`, entityIds, "Entity", "unknown_entity_id", issues, evidence);
  requireReference(evidence.artifactId, `${basePath}.artifactId`, artifactsById, "Artifact", "unknown_artifact_id", issues, evidence);
  requireReference(evidence.chunkId, `${basePath}.chunkId`, chunksById, "Chunk", "unknown_chunk_id", issues, evidence);
  requireEnum(evidence.kind, EVIDENCE_KINDS, `${basePath}.kind`, "unsupported_evidence_kind", issues, evidence);
  requireString(evidence.quote, `${basePath}.quote`, "missing_quote", issues, evidence);
  validateUrl(evidence.url, `${basePath}.url`, issues, evidence);

  const race = typeof evidence.raceId === "string" ? racesById.get(evidence.raceId) : undefined;
  const artifact = typeof evidence.artifactId === "string" ? artifactsById.get(evidence.artifactId) : undefined;
  const chunk = typeof evidence.chunkId === "string" ? chunksById.get(evidence.chunkId) : undefined;

  if (race && typeof evidence.sourceId === "string" && !race.sourceIds.includes(evidence.sourceId)) {
    addIssue(issues, "source_not_in_race", "error", `${basePath}.sourceId`, `Source '${evidence.sourceId}' is not allowed for race '${race.id}'.`, evidence);
  }
  if (race && typeof evidence.entityId === "string" && !race.entityIds.includes(evidence.entityId)) {
    addIssue(issues, "entity_not_in_race", "error", `${basePath}.entityId`, `Entity '${evidence.entityId}' is not in race '${race.id}'.`, evidence);
  }
  if (artifact) {
    if (artifact.sourceId !== evidence.sourceId) addIssue(issues, "artifact_source_mismatch", "error", `${basePath}.artifactId`, "Artifact sourceId must match evidence sourceId.", evidence);
    if (artifact.url !== evidence.url) addIssue(issues, "artifact_url_mismatch", "warning", `${basePath}.url`, "Evidence URL differs from artifact URL.", evidence);
  }
  if (chunk) {
    if (chunk.artifactId !== evidence.artifactId) addIssue(issues, "chunk_artifact_mismatch", "error", `${basePath}.chunkId`, "Chunk artifactId must match evidence artifactId.", evidence);
    if (chunk.sourceId !== evidence.sourceId) addIssue(issues, "chunk_source_mismatch", "error", `${basePath}.chunkId`, "Chunk sourceId must match evidence sourceId.", evidence);
    if (typeof evidence.quote === "string" && evidence.quote.trim().length > 0 && !chunk.text.includes(evidence.quote)) {
      addIssue(issues, "quote_not_in_chunk", "error", `${basePath}.quote`, "Evidence quote must be present in the referenced chunk text.", evidence);
    }
  }
}

function validateDuplicateIds(items: unknown[], basePath: string, issues: ExtractionValidationIssue[]): void {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string") return;
    const firstIndex = seen.get(item.id);
    if (firstIndex !== undefined) {
      addIssue(issues, "duplicate_id", "error", `${basePath}[${index}].id`, `Duplicate id '${item.id}' first seen at ${basePath}[${firstIndex}].id.`, item);
    } else {
      seen.set(item.id, index);
    }
  });
}

function requireReference<T>(
  value: unknown,
  issuePath: string,
  allowed: Set<string> | Map<string, T>,
  label: string,
  code: string,
  issues: ExtractionValidationIssue[],
  context?: IssueContext,
): boolean {
  if (!requireString(value, issuePath, code, issues, context)) return false;
  if (!allowed.has(value)) {
    addIssue(issues, code, "error", issuePath, `${label} '${value}' does not exist.`, context);
    return false;
  }
  return true;
}

function requireKebab(value: unknown, issuePath: string, code: string, issues: ExtractionValidationIssue[], context?: IssueContext): boolean {
  if (!requireString(value, issuePath, code, issues, context)) return false;
  if (!ID_PATTERN.test(value)) {
    addIssue(issues, code, "error", issuePath, "Must be lowercase kebab-case.", context);
    return false;
  }
  return true;
}

function requireString(value: unknown, issuePath: string, code: string, issues: ExtractionValidationIssue[], context?: IssueContext): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    addIssue(issues, code, "error", issuePath, "Must be a non-empty string.", context);
    return false;
  }
  return true;
}

function requireEnum(
  value: unknown,
  allowed: Set<string>,
  issuePath: string,
  code: string,
  issues: ExtractionValidationIssue[],
  context?: IssueContext,
): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    addIssue(issues, code, "error", issuePath, `Unsupported value '${String(value)}'.`, context);
  }
}

function validateUrl(value: unknown, issuePath: string, issues: ExtractionValidationIssue[], context?: IssueContext): void {
  if (!requireString(value, issuePath, "missing_url", issues, context)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    addIssue(issues, "invalid_url", "error", issuePath, "Must be a parseable http(s) URL.", context);
  }
}

function addIssue(
  issues: ExtractionValidationIssue[],
  code: string,
  severity: ExtractionValidationIssue["severity"],
  issuePath: string,
  message: string,
  context?: IssueContext,
): void {
  issues.push({
    code,
    severity,
    path: issuePath,
    message: message.replace(/\s+/g, " ").trim(),
    sourceId: typeof context?.sourceId === "string" ? context.sourceId : undefined,
    artifactId: typeof context?.artifactId === "string" ? context.artifactId : undefined,
    chunkId: typeof context?.chunkId === "string" ? context.chunkId : undefined,
    raceId: typeof context?.raceId === "string" ? context.raceId : undefined,
    entityId: typeof context?.entityId === "string" ? context.entityId : undefined,
  });
}

function countValidation(positions: number, evidence: number, issues: ExtractionValidationIssue[]): ExtractionRunCounts {
  return {
    inputs: 0,
    positions,
    evidence,
    issues: issues.length,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
  };
}

function compareIssues(left: ExtractionValidationIssue, right: ExtractionValidationIssue): number {
  return `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
