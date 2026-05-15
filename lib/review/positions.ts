import { promises as fs } from "node:fs";
import path from "node:path";
import { DataLoadError, loadPublicRaceData, loadRaceData } from "../data/loaders";
import type { Evidence, Position, PublicationStatus, Race, ReviewStatus } from "../data/types";
import type { DraftEvidence, DraftPosition, ExtractionDraft, ExtractionProviderMetadata } from "../extraction/types";

export type ReviewCommand = "prepare" | "status" | "publish";
export type ReviewIssueSeverity = "info" | "warning" | "error";
export type PublishReadiness = "ready" | "not-ready";

export interface PositionReviewFile {
  version: 1;
  raceSlug: string;
  raceId: string;
  sourceDraftPath: string;
  runId: string;
  provider: ExtractionProviderMetadata;
  status: "prepared" | "partially-ready" | "ready" | "published";
  updatedAt: string;
  positions: ReviewedPosition[];
}

export interface ReviewedPosition {
  id: string;
  draftPositionId: string;
  sourceDraft: {
    runId: string;
    draftPath: string;
    generatedAt?: string;
    generatedBy?: ExtractionProviderMetadata;
  };
  raceId: string;
  sourceId: string;
  entityId: string;
  kind: Position["kind"];
  status: ReviewStatus;
  publicationStatus: PublicationStatus;
  label: string;
  rationale?: string;
  reviewerNotes?: string;
  evidenceIds: string[];
  evidence: ReviewedEvidence[];
}

export interface ReviewedEvidence extends Evidence {
  positionId: string;
  artifactId: string;
  chunkId: string;
}

export interface ReviewIssue {
  code: string;
  severity: ReviewIssueSeverity;
  path: string;
  message: string;
  phase: "prepare" | "review" | "publish" | "load";
}

export interface ReviewWorkflowResult {
  ok: boolean;
  command: ReviewCommand;
  raceSlug: string;
  phase: ReviewIssue["phase"];
  reviewPath: string;
  sourceDraftPath?: string;
  overridePath?: string;
  counts: {
    positions: number;
    ready: number;
    published: number;
    rejected: number;
    hidden: number;
    issues: number;
    errors: number;
    warnings: number;
  };
  issues: ReviewIssue[];
  checkedFiles: string[];
  publicPositionIds?: string[];
}

export interface ReviewWorkflowOptions {
  raceSlug: string;
  draftPath?: string;
  reviewsDir?: string;
  overridesDir?: string;
  publicDir?: string;
  now?: () => Date;
}

export class ReviewWorkflowError extends Error {
  readonly result: ReviewWorkflowResult;

  constructor(message: string, result: ReviewWorkflowResult) {
    super(message);
    this.name = "ReviewWorkflowError";
    this.result = result;
  }
}

const DEFAULT_DRAFT_PATH = path.join(process.cwd(), "data", "extracted", "drafts", "latest.json");
const DEFAULT_REVIEWS_DIR = path.join(process.cwd(), "manual", "reviews");
const DEFAULT_OVERRIDES_DIR = path.join(process.cwd(), "manual", "overrides");
const PUBLIC_REVIEW_STATUSES = new Set<ReviewStatus>(["verified", "published"]);

export async function preparePositionReview(options: ReviewWorkflowOptions): Promise<ReviewWorkflowResult> {
  const now = options.now ?? (() => new Date());
  const draftPath = options.draftPath ?? DEFAULT_DRAFT_PATH;
  const reviewPath = raceReviewPath(options.raceSlug, options.reviewsDir);
  const issues: ReviewIssue[] = [];
  const checkedFiles = [relative(draftPath)];
  const draft = await readDraft(draftPath, options.raceSlug, "prepare", issues);
  const loaded = await loadRaceData(options.raceSlug, { publicDir: options.publicDir, overridesDir: options.overridesDir });
  if (!loaded) {
    issues.push(issue("unknown_race", "error", "raceSlug", `Race '${options.raceSlug}' does not exist.`, "prepare"));
  } else {
    checkedFiles.push(...loaded.checkedFiles);
  }

  const existing = await readOptionalReview(reviewPath, options.raceSlug, issues);
  if (existing) checkedFiles.push(relative(reviewPath));

  if (!draft || !loaded || hasErrors(issues)) {
    return result("prepare", options.raceSlug, "prepare", reviewPath, draftPath, undefined, emptyCounts(issues), issues, checkedFiles);
  }

  const racePositions = draft.positions.filter((position) => position.raceId === loaded.race.id);
  const evidenceByPosition = new Map<string, DraftEvidence[]>();
  for (const evidence of draft.evidence) {
    if (evidence.raceId !== loaded.race.id) continue;
    const current = evidenceByPosition.get(evidence.positionId) ?? [];
    current.push(evidence);
    evidenceByPosition.set(evidence.positionId, current);
  }

  const existingByDraftId = new Map((existing?.positions ?? []).map((position) => [position.draftPositionId, position]));
  const review: PositionReviewFile = {
    version: 1,
    raceSlug: options.raceSlug,
    raceId: loaded.race.id,
    sourceDraftPath: relative(draftPath),
    runId: draft.runId,
    provider: draft.provider,
    status: "prepared",
    updatedAt: now().toISOString(),
    positions: racePositions.map((position) => toReviewedPosition(position, evidenceByPosition.get(position.id) ?? [], existingByDraftId.get(position.id), draft, relative(draftPath))),
  };
  const readinessIssues = validateReview(review, "review").filter((candidate) => candidate.severity === "error");
  review.status = computeReviewStatus(review, readinessIssues);

  await writeJson(reviewPath, review);
  checkedFiles.push(relative(reviewPath));
  return result("prepare", options.raceSlug, "prepare", reviewPath, draftPath, undefined, countsFor(review, [...issues, ...readinessIssues]), [...issues, ...readinessIssues], checkedFiles);
}

export async function statusPositionReview(options: ReviewWorkflowOptions): Promise<ReviewWorkflowResult> {
  const reviewPath = raceReviewPath(options.raceSlug, options.reviewsDir);
  const issues: ReviewIssue[] = [];
  const review = await readRequiredReview(reviewPath, options.raceSlug, "review", issues);
  if (!review || hasErrors(issues)) return result("status", options.raceSlug, "review", reviewPath, undefined, undefined, emptyCounts(issues), issues, [relative(reviewPath)]);
  const validationIssues = validateReview(review, "review");
  return result("status", options.raceSlug, "review", reviewPath, review.sourceDraftPath, raceOverridePath(options.raceSlug, options.overridesDir), countsFor(review, validationIssues), validationIssues, [relative(reviewPath)]);
}

export async function publishPositionReview(options: ReviewWorkflowOptions): Promise<ReviewWorkflowResult> {
  const reviewPath = raceReviewPath(options.raceSlug, options.reviewsDir);
  const overridePath = raceOverridePath(options.raceSlug, options.overridesDir);
  const issues: ReviewIssue[] = [];
  const checkedFiles = [relative(reviewPath)];
  const review = await readRequiredReview(reviewPath, options.raceSlug, "review", issues);
  if (!review) return result("publish", options.raceSlug, "review", reviewPath, undefined, overridePath, emptyCounts(issues), issues, checkedFiles);

  issues.push(...validateReview(review, "review"));
  const publishable = review.positions.filter((position) => position.publicationStatus === "public");
  const hidden = review.positions.filter((position) => position.publicationStatus !== "public");
  for (const position of publishable) validatePublishablePosition(position, issues);
  for (const position of hidden) {
    if (position.status === "rejected") continue;
    if (position.status === "draft") issues.push(issue("unreviewed_hidden_position", "warning", `positions.${position.id}.status`, "Hidden draft remains unpublished.", "publish"));
  }

  if (hasErrors(issues)) return result("publish", options.raceSlug, "publish", reviewPath, review.sourceDraftPath, overridePath, countsFor(review, issues), issues, checkedFiles);

  const existingOverride = await readOverride(overridePath, options.raceSlug, issues);
  if (hasErrors(issues)) return result("publish", options.raceSlug, "publish", reviewPath, review.sourceDraftPath, overridePath, countsFor(review, issues), issues, checkedFiles);

  const override = mergeOverride(existingOverride, review, publishable.map(toPublicPosition));
  await writeJson(overridePath, override);
  checkedFiles.push(relative(overridePath));

  try {
    const loaded = await loadRaceData(options.raceSlug, { publicDir: options.publicDir, overridesDir: options.overridesDir });
    if (loaded) checkedFiles.push(...loaded.checkedFiles);
    const publicLoaded = await loadPublicRaceData(options.raceSlug, { publicDir: options.publicDir, overridesDir: options.overridesDir });
    if (!publicLoaded && publishable.length > 0) issues.push(issue("public_loader_empty", "error", "loadPublicRaceData", "Public race loader returned no race after publishing public positions.", "load"));
  } catch (error) {
    issues.push(dataLoadIssue(error));
  }

  if (!hasErrors(issues)) {
    review.status = "published";
    review.updatedAt = (options.now ?? (() => new Date()))().toISOString();
    await writeJson(reviewPath, review);
  }

  return result("publish", options.raceSlug, hasErrors(issues) ? "load" : "publish", reviewPath, review.sourceDraftPath, overridePath, countsFor(review, issues), issues, checkedFiles, publishable.map((position) => position.id));
}

export async function readRaceReviewModel(slug: string, options: Pick<ReviewWorkflowOptions, "reviewsDir" | "draftPath"> = {}): Promise<{ review: PositionReviewFile | null; issues: ReviewIssue[]; draft: ExtractionDraft | null; reviewPath: string; draftPath: string }> {
  const reviewPath = raceReviewPath(slug, options.reviewsDir);
  const draftPath = options.draftPath ?? DEFAULT_DRAFT_PATH;
  const issues: ReviewIssue[] = [];
  const review = await readOptionalReview(reviewPath, slug, issues);
  let draft: ExtractionDraft | null = null;
  try {
    draft = JSON.parse(await fs.readFile(draftPath, "utf8")) as ExtractionDraft;
  } catch {
    draft = null;
  }
  if (review) issues.push(...validateReview(review, "review"));
  return { review, issues, draft, reviewPath: relative(reviewPath), draftPath: relative(draftPath) };
}

function toReviewedPosition(position: DraftPosition, evidence: DraftEvidence[], existing: ReviewedPosition | undefined, draft: ExtractionDraft, draftPath: string): ReviewedPosition {
  const reviewedEvidence = evidence.map((item) => toReviewedEvidence(item));
  return {
    id: existing?.id ?? position.id,
    draftPositionId: position.id,
    sourceDraft: { runId: draft.runId, draftPath, generatedAt: position.generatedAt, generatedBy: position.generatedBy },
    raceId: position.raceId,
    sourceId: position.sourceId,
    entityId: position.entityId,
    kind: existing?.kind ?? position.kind,
    status: existing?.status ?? "draft",
    publicationStatus: existing?.publicationStatus ?? "hidden",
    label: existing?.label ?? position.label,
    rationale: existing?.rationale ?? position.rationale,
    reviewerNotes: existing?.reviewerNotes ?? "",
    evidenceIds: existing?.evidenceIds ?? reviewedEvidence.map((item) => item.id),
    evidence: existing?.evidence ?? reviewedEvidence,
  };
}

function toReviewedEvidence(evidence: DraftEvidence): ReviewedEvidence {
  return {
    id: evidence.id,
    positionId: evidence.positionId,
    sourceId: evidence.sourceId,
    entityId: evidence.entityId,
    raceId: evidence.raceId,
    artifactId: evidence.artifactId,
    chunkId: evidence.chunkId,
    url: evidence.url,
    kind: evidence.kind,
    quote: evidence.quote,
  };
}

function toPublicPosition(position: ReviewedPosition): Position {
  return {
    id: position.id,
    raceId: position.raceId,
    sourceId: position.sourceId,
    entityId: position.entityId,
    kind: position.kind,
    status: position.status === "published" ? "published" : "verified",
    publicationStatus: "public",
    label: position.label,
    ...(position.rationale ? { rationale: position.rationale } : {}),
    evidenceIds: position.evidenceIds,
    evidence: position.evidence.map(({ positionId: _positionId, chunkId: _chunkId, ...evidence }) => evidence),
  };
}

function validateReview(review: PositionReviewFile, phase: ReviewIssue["phase"]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (!isRecord(review)) return [issue("invalid_review_shape", "error", "$", "Review file must be an object.", phase)];
  if (review.version !== 1) issues.push(issue("unsupported_review_version", "error", "version", "Review file version must be 1.", phase));
  requireString(review.raceSlug, "raceSlug", "missing_race_slug", phase, issues);
  requireString(review.raceId, "raceId", "missing_race_id", phase, issues);
  requireString(review.sourceDraftPath, "sourceDraftPath", "missing_source_draft_path", phase, issues);
  requireString(review.runId, "runId", "missing_run_id", phase, issues);
  if (!Array.isArray(review.positions)) {
    issues.push(issue("invalid_review_positions", "error", "positions", "Review positions must be an array.", phase));
    return issues;
  }
  validateDuplicate(review.positions.map((position) => position.id), "positions[].id", "duplicate_review_id", phase, issues);
  validateDuplicate(review.positions.map((position) => position.draftPositionId), "positions[].draftPositionId", "duplicate_draft_position_id", phase, issues);
  review.positions.forEach((position, index) => validateReviewedPosition(position, `positions[${index}]`, phase, issues));
  return issues;
}

function validateReviewedPosition(position: ReviewedPosition, basePath: string, phase: ReviewIssue["phase"], issues: ReviewIssue[]): void {
  if (!isRecord(position)) {
    issues.push(issue("invalid_review_position", "error", basePath, "Review position must be an object.", phase));
    return;
  }
  requireString(position.id, `${basePath}.id`, "missing_review_id", phase, issues);
  requireString(position.draftPositionId, `${basePath}.draftPositionId`, "missing_draft_position_id", phase, issues);
  requireString(position.raceId, `${basePath}.raceId`, "missing_race_id", phase, issues);
  requireString(position.sourceId, `${basePath}.sourceId`, "missing_source_id", phase, issues);
  requireString(position.entityId, `${basePath}.entityId`, "missing_entity_id", phase, issues);
  requireString(position.label, `${basePath}.label`, "missing_label", phase, issues);
  if (!isReviewStatus(position.status)) issues.push(issue("unsupported_review_status", "error", `${basePath}.status`, `Unsupported review status '${String(position.status)}'.`, phase));
  if (!isPublicationStatus(position.publicationStatus)) issues.push(issue("unsupported_publication_status", "error", `${basePath}.publicationStatus`, `Unsupported publication status '${String(position.publicationStatus)}'.`, phase));
  if (!Array.isArray(position.evidenceIds)) issues.push(issue("invalid_evidence_ids", "error", `${basePath}.evidenceIds`, "evidenceIds must be an array.", phase));
  if (!Array.isArray(position.evidence)) {
    issues.push(issue("invalid_evidence", "error", `${basePath}.evidence`, "evidence must be an array.", phase));
    return;
  }
  validateDuplicate(position.evidence.map((item) => item.id), `${basePath}.evidence[].id`, "duplicate_evidence_id", phase, issues);
  const evidenceById = new Set(position.evidence.map((item) => item.id));
  for (const evidenceId of position.evidenceIds ?? []) {
    if (!evidenceById.has(evidenceId)) issues.push(issue("missing_review_evidence_reference", "error", `${basePath}.evidenceIds`, `Evidence '${evidenceId}' is not present in this review position.`, phase));
  }
  position.evidence.forEach((evidence, index) => {
    requireString(evidence.id, `${basePath}.evidence[${index}].id`, "missing_evidence_id", phase, issues);
    requireString(evidence.quote, `${basePath}.evidence[${index}].quote`, "missing_evidence_quote", phase, issues);
    requireString(evidence.url, `${basePath}.evidence[${index}].url`, "missing_evidence_url", phase, issues);
    requireString(evidence.artifactId, `${basePath}.evidence[${index}].artifactId`, "missing_artifact_id", phase, issues);
    requireString(evidence.chunkId, `${basePath}.evidence[${index}].chunkId`, "missing_chunk_id", phase, issues);
  });
}

function validatePublishablePosition(position: ReviewedPosition, issues: ReviewIssue[]): void {
  const pathPrefix = `positions.${position.id}`;
  if (!PUBLIC_REVIEW_STATUSES.has(position.status)) issues.push(issue("unreviewed_public_position", "error", `${pathPrefix}.status`, "Public positions must be verified or published before publication.", "publish"));
  if (position.status === "rejected") issues.push(issue("rejected_public_position", "error", `${pathPrefix}.status`, "Rejected positions cannot be published.", "publish"));
  if (position.evidenceIds.length === 0 || position.evidence.length === 0) issues.push(issue("missing_publish_evidence", "error", `${pathPrefix}.evidence`, "Published positions must include evidence.", "publish"));
  for (const evidence of position.evidence) {
    if (!evidence.quote?.trim()) issues.push(issue("missing_publish_evidence_quote", "error", `${pathPrefix}.evidence.${evidence.id}.quote`, "Published evidence must include a quote.", "publish"));
  }
}

function mergeOverride(existing: Record<string, unknown> | null, review: PositionReviewFile, positions: Position[]): Record<string, unknown> {
  const base = structuredClone(existing ?? { race: {} }) as Record<string, unknown>;
  const race = isRecord(base.race) ? { ...base.race } : {};
  const existingPositions = Array.isArray(race.positions) ? race.positions.filter(isRecord) : [];
  const ownedIds = new Set(positions.map((position) => position.id));
  if (positions.length > 0) {
    race.status = race.status === "published" ? "published" : "verified";
    race.publicationStatus = "public";
  }
  race.positions = [...existingPositions.filter((position) => typeof position.id !== "string" || !ownedIds.has(position.id)), ...positions];
  race.extractionReview = {
    sourceDraftPath: review.sourceDraftPath,
    reviewPath: `manual/reviews/races/${review.raceSlug}.json`,
    runId: review.runId,
    publishedAt: review.updatedAt,
  };
  return { ...base, race };
}

async function readDraft(filePath: string, raceSlug: string, phase: ReviewIssue["phase"], issues: ReviewIssue[]): Promise<ExtractionDraft | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as ExtractionDraft;
  } catch (error) {
    issues.push(issue(error instanceof SyntaxError ? "malformed_draft_json" : "missing_draft_file", "error", relative(filePath), `Unable to read draft for race '${raceSlug}': ${formatError(error)}`, phase));
    return null;
  }
}

async function readOptionalReview(filePath: string, raceSlug: string, issues: ReviewIssue[]): Promise<PositionReviewFile | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as PositionReviewFile;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    issues.push(issue(error instanceof SyntaxError ? "malformed_review_json" : "read_review_error", "error", relative(filePath), `Unable to read review for race '${raceSlug}': ${formatError(error)}`, "review"));
    return null;
  }
}

async function readRequiredReview(filePath: string, raceSlug: string, phase: ReviewIssue["phase"], issues: ReviewIssue[]): Promise<PositionReviewFile | null> {
  const review = await readOptionalReview(filePath, raceSlug, issues);
  if (!review && !issues.some((candidate) => candidate.path === relative(filePath))) issues.push(issue("missing_review_file", "error", relative(filePath), `Review file for race '${raceSlug}' does not exist. Run prepare first.`, phase));
  return review;
}

async function readOverride(filePath: string, raceSlug: string, issues: ReviewIssue[]): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    issues.push(issue(error instanceof SyntaxError ? "malformed_override_json" : "read_override_error", "error", relative(filePath), `Unable to read override for race '${raceSlug}': ${formatError(error)}`, "publish"));
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function computeReviewStatus(review: PositionReviewFile, validationIssues: ReviewIssue[]): PositionReviewFile["status"] {
  if (validationIssues.length > 0) return "prepared";
  if (review.positions.some((position) => position.publicationStatus === "public" && PUBLIC_REVIEW_STATUSES.has(position.status))) return "ready";
  if (review.positions.some((position) => position.status !== "draft")) return "partially-ready";
  return "prepared";
}

function countsFor(review: PositionReviewFile, issues: ReviewIssue[]): ReviewWorkflowResult["counts"] {
  return {
    positions: review.positions.length,
    ready: review.positions.filter((position) => position.publicationStatus === "public" && PUBLIC_REVIEW_STATUSES.has(position.status)).length,
    published: review.positions.filter((position) => position.status === "published" || (position.status === "verified" && position.publicationStatus === "public")).length,
    rejected: review.positions.filter((position) => position.status === "rejected").length,
    hidden: review.positions.filter((position) => position.publicationStatus !== "public").length,
    issues: issues.length,
    errors: issues.filter((item) => item.severity === "error").length,
    warnings: issues.filter((item) => item.severity === "warning").length,
  };
}

function emptyCounts(issues: ReviewIssue[]): ReviewWorkflowResult["counts"] {
  return { positions: 0, ready: 0, published: 0, rejected: 0, hidden: 0, issues: issues.length, errors: issues.filter((item) => item.severity === "error").length, warnings: issues.filter((item) => item.severity === "warning").length };
}

function result(command: ReviewCommand, raceSlug: string, phase: ReviewIssue["phase"], reviewPath: string, sourceDraftPath: string | undefined, overridePath: string | undefined, counts: ReviewWorkflowResult["counts"], issues: ReviewIssue[], checkedFiles: string[], publicPositionIds?: string[]): ReviewWorkflowResult {
  return { ok: counts.errors === 0, command, raceSlug, phase, reviewPath: relative(reviewPath), sourceDraftPath: sourceDraftPath ? relative(sourceDraftPath) : undefined, overridePath: overridePath ? relative(overridePath) : undefined, counts, issues: issues.sort((left, right) => `${left.phase}:${left.path}:${left.code}`.localeCompare(`${right.phase}:${right.path}:${right.code}`)), checkedFiles: [...new Set(checkedFiles.map(relative))], publicPositionIds };
}

function dataLoadIssue(error: unknown): ReviewIssue {
  if (error instanceof DataLoadError) {
    return issue("data_load_error", "error", error.sourcePath ?? error.phase, `DataLoadError during ${error.phase}: ${error.message}`, "load");
  }
  return issue("data_load_error", "error", "loadRaceData", formatError(error), "load");
}

function issue(code: string, severity: ReviewIssueSeverity, issuePath: string, message: string, phase: ReviewIssue["phase"]): ReviewIssue {
  return { code, severity, path: issuePath, message: message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/\s+/g, " ").trim(), phase };
}

function validateDuplicate(values: unknown[], pathLabel: string, code: string, phase: ReviewIssue["phase"], issues: ReviewIssue[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    if (seen.has(value)) issues.push(issue(code, "error", pathLabel, `Duplicate id '${value}'.`, phase));
    seen.add(value);
  }
}

function requireString(value: unknown, pathName: string, code: string, phase: ReviewIssue["phase"], issues: ReviewIssue[]): value is string {
  if (typeof value === "string" && value.trim().length > 0) return true;
  issues.push(issue(code, "error", pathName, "Must be a non-empty string.", phase));
  return false;
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "draft" || value === "reviewed" || value === "verified" || value === "published" || value === "rejected";
}

function isPublicationStatus(value: unknown): value is PublicationStatus {
  return value === "hidden" || value === "public" || value === "archived";
}

function hasErrors(issues: ReviewIssue[]): boolean {
  return issues.some((item) => item.severity === "error");
}

function raceReviewPath(slug: string, reviewsDir = DEFAULT_REVIEWS_DIR): string {
  return path.join(reviewsDir, "races", `${slug}.json`);
}

function raceOverridePath(slug: string, overridesDir = DEFAULT_OVERRIDES_DIR): string {
  return path.join(overridesDir, "races", `${slug}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]") : String(error);
}

function relative(filePath: string): string {
  return path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) || filePath : filePath;
}
