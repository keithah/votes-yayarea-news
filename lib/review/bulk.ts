import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Race } from "../data/types";
import { DataLoadError } from "../data/loaders";
import { assembleExtractionPrompts } from "../extraction/prompt";
import type { DraftPosition, ExtractionDraft, ExtractionValidationIssue } from "../extraction/types";
import { validateExtractionDraft } from "../extraction/validate";
import { preparePositionReview, publishPositionReview, type PositionReviewFile, type ReviewIssue, type ReviewWorkflowResult } from "./positions";

export type BulkReviewIssueStatus = "hidden" | "rejected" | "error";
export type BulkReviewIssuePhase = "read" | "validate" | "prepare" | "review" | "publish" | "load" | "write";

export interface BulkReviewOptions {
  draftPath?: string;
  manifestPath?: string;
  reviewsDir?: string;
  overridesDir?: string;
  publicDir?: string;
  diagnosticsDir?: string;
  diagnosticsPath?: string;
  now?: () => Date;
}

export interface BulkReviewIssue {
  phase: BulkReviewIssuePhase;
  status: BulkReviewIssueStatus;
  reasonCode: string;
  path: string;
  message: string;
  raceId?: string;
  raceSlug?: string;
  sourceId?: string;
  entityId?: string;
  artifactId?: string;
  chunkId?: string;
  positionId?: string;
  evidenceId?: string;
}

export interface BulkRaceResult {
  raceSlug: string;
  raceId: string;
  reviewPath: string;
  overridePath?: string;
  status: "prepared" | "published" | "failed";
  counts: {
    positions: number;
    public: number;
    hidden: number;
    rejected: number;
    issues: number;
    errors: number;
  };
  publicPositionIds: string[];
  issueCodes: string[];
}

export interface BulkReviewDiagnostics {
  ok: boolean;
  generatedAt: string;
  checkedFiles: string[];
  sourceDraftPath: string;
  diagnosticsPath: string;
  counts: {
    positions: number;
    races: number;
    published: number;
    public: number;
    hidden: number;
    rejected: number;
    errors: number;
    issues: number;
  };
  races: BulkRaceResult[];
  issues: BulkReviewIssue[];
}

const DEFAULT_DRAFT_PATH = path.join(process.cwd(), "data", "extracted", "drafts", "latest.json");
const DEFAULT_MANIFEST_PATH = path.join(process.cwd(), "data", "ingestion", "manifest.json");
const DEFAULT_REVIEWS_DIR = path.join(process.cwd(), "manual", "reviews");
const DEFAULT_OVERRIDES_DIR = path.join(process.cwd(), "manual", "overrides");
const DEFAULT_DIAGNOSTICS_DIR = path.join(process.cwd(), "data", "reviewed");
const PUBLIC_REVIEW_STATUSES = new Set(["reviewed", "verified", "published"]);
const SUPPORTED_POSITION_KINDS = new Set(["endorse", "oppose", "rank", "no-position", "informational"]);

export async function runBulkPositionReview(options: BulkReviewOptions = {}): Promise<BulkReviewDiagnostics> {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const draftPath = options.draftPath ?? DEFAULT_DRAFT_PATH;
  const diagnosticsPath = options.diagnosticsPath ?? path.join(options.diagnosticsDir ?? DEFAULT_DIAGNOSTICS_DIR, "bulk-review-latest.json");
  const checkedFiles = new Set<string>([relative(draftPath)]);
  const issues: BulkReviewIssue[] = [];
  const races: BulkRaceResult[] = [];

  const draft = await readDraft(draftPath, issues);
  if (!draft) {
    return writeDiagnostics(diagnosticsPath, buildDiagnostics({ ok: false, generatedAt, checkedFiles, draftPath, diagnosticsPath, positions: 0, races, issues }));
  }

  let assembly;
  try {
    assembly = await assembleExtractionPrompts({ manifestPath: options.manifestPath ?? DEFAULT_MANIFEST_PATH, publicDir: options.publicDir });
    assembly.checkedFiles.forEach((file) => checkedFiles.add(file));
  } catch (error) {
    issues.push(bulkIssue("validate", "error", "context_load_error", options.manifestPath ?? DEFAULT_MANIFEST_PATH, sanitizeError(error)));
    return writeDiagnostics(diagnosticsPath, buildDiagnostics({ ok: false, generatedAt, checkedFiles, draftPath, diagnosticsPath, positions: draft.positions?.length ?? 0, races, issues }));
  }

  const validation = validateExtractionDraft(draft, { publicData: assembly.publicData, artifacts: assembly.artifacts, chunks: assembly.chunks, checkedFiles: assembly.checkedFiles });
  validation.checkedFiles.forEach((file) => checkedFiles.add(file));
  const validationIssuesByPosition = indexValidationIssues(validation.issues, draft);
  const racesById = new Map(assembly.publicData.races.map((race) => [race.id, race]));
  const sourceIds = new Set(assembly.publicData.sources.map((source) => source.id));
  const entityIds = new Set(assembly.publicData.entities.map((entity) => entity.id));
  const duplicatePublicIds = findDuplicatePublicClaimPositionIds(draft.positions ?? []);

  const positionsByKnownRace = new Map<string, DraftPosition[]>();
  for (const position of draft.positions ?? []) {
    const race = typeof position.raceId === "string" ? racesById.get(position.raceId) : undefined;
    if (!race) {
      issues.push(issueForPosition("validate", "rejected", "unknown_race_id", "Draft position references an unknown race and cannot be mapped to a public race slug.", position));
      continue;
    }
    const list = positionsByKnownRace.get(race.slug) ?? [];
    list.push(position);
    positionsByKnownRace.set(race.slug, list);
  }

  for (const [raceSlug, racePositions] of [...positionsByKnownRace.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const race = racesById.get(racePositions[0]?.raceId);
    if (!race) continue;
    let prepareResult: ReviewWorkflowResult;
    try {
      prepareResult = await preparePositionReview({ raceSlug, draftPath, reviewsDir: options.reviewsDir, overridesDir: options.overridesDir, publicDir: options.publicDir, now });
      prepareResult.checkedFiles.forEach((file) => checkedFiles.add(file));
    } catch (error) {
      const mapped = dataLoadBulkIssue(error, "prepare", race, raceSlug) ?? bulkIssue("prepare", "error", "prepare_error", raceSlug, sanitizeError(error), { raceId: race.id, raceSlug });
      issues.push(mapped);
      races.push(emptyRaceResult(race, raceSlug, options, "failed", [mapped]));
      continue;
    }

    issues.push(...prepareResult.issues.map((issue) => fromReviewIssue(issue, race, raceSlug)));
    if (!prepareResult.ok) {
      races.push(resultFromWorkflow(race, prepareResult, "failed", [], issues));
      continue;
    }

    const reviewPath = raceReviewPath(raceSlug, options.reviewsDir);
    let review: PositionReviewFile;
    try {
      review = JSON.parse(await fs.readFile(reviewPath, "utf8")) as PositionReviewFile;
      checkedFiles.add(relative(reviewPath));
    } catch (error) {
      const mapped = bulkIssue("review", "error", error instanceof SyntaxError ? "malformed_review_json" : "read_review_error", reviewPath, sanitizeError(error), { raceId: race.id, raceSlug });
      issues.push(mapped);
      races.push(emptyRaceResult(race, raceSlug, options, "failed", [mapped]));
      continue;
    }

    const raceIssues = classifyReview(review, { draft, race, sourceIds, entityIds, validationIssuesByPosition, duplicatePublicIds });
    issues.push(...raceIssues);
    try {
      await writeJson(reviewPath, review);
    } catch (error) {
      const mapped = bulkIssue("write", "error", "write_review_error", reviewPath, sanitizeError(error), { raceId: race.id, raceSlug });
      issues.push(mapped);
      races.push(emptyRaceResult(race, raceSlug, options, "failed", [mapped]));
      continue;
    }

    if (!review.positions.some((position) => position.publicationStatus === "public")) {
      races.push(reviewRaceResult(race, raceSlug, review, options, "prepared", [], raceIssues));
      continue;
    }

    const preflightResult = await preflightPublish({ raceSlug, options, now });
    preflightResult.checkedFiles.forEach((file) => checkedFiles.add(file));
    const preflightIssues = preflightResult.issues.map((issue) => fromReviewIssue(issue, race, raceSlug));
    if (!preflightResult.ok) {
      hidePublicReviewPositions(review, preflightIssues[0]?.reasonCode ?? "publish_preflight_failed");
      await writeJson(reviewPath, review);
      issues.push(...preflightIssues);
      races.push(resultFromWorkflow(race, preflightResult, "failed", [], [...raceIssues, ...preflightIssues]));
      continue;
    }

    const publishResult = await publishPositionReview({ raceSlug, reviewsDir: options.reviewsDir, overridesDir: options.overridesDir, publicDir: options.publicDir, now });
    publishResult.checkedFiles.forEach((file) => checkedFiles.add(file));
    const publishIssues = publishResult.issues.map((issue) => fromReviewIssue(issue, race, raceSlug));
    issues.push(...publishIssues);
    races.push(resultFromWorkflow(race, publishResult, publishResult.ok ? "published" : "failed", publishResult.publicPositionIds ?? [], [...raceIssues, ...publishIssues]));
  }

  return writeDiagnostics(diagnosticsPath, buildDiagnostics({ ok: !issues.some((issue) => issue.status === "error"), generatedAt, checkedFiles, draftPath, diagnosticsPath, positions: draft.positions?.length ?? 0, races, issues }));
}

function classifyReview(review: PositionReviewFile, context: { draft: ExtractionDraft; race: Race; sourceIds: Set<string>; entityIds: Set<string>; validationIssuesByPosition: Map<string, ExtractionValidationIssue[]>; duplicatePublicIds: Set<string> }): BulkReviewIssue[] {
  const issues: BulkReviewIssue[] = [];
  const draftById = new Map((context.draft.positions ?? []).map((position) => [position.id, position]));
  const evidenceById = new Map((context.draft.evidence ?? []).map((evidence) => [evidence.id, evidence]));

  for (const position of review.positions) {
    const draftPosition = draftById.get(position.draftPositionId);
    const positionIssues = draftPosition ? context.validationIssuesByPosition.get(draftPosition.id) ?? [] : [];
    const wantsPublic = draftPosition ? wantsPublicPublication(draftPosition) : false;
    const reason = firstGateFailure(position, draftPosition, positionIssues, context, evidenceById);

    if (!wantsPublic) {
      position.status = "reviewed";
      position.publicationStatus = "hidden";
      position.reviewerNotes = appendNote(position.reviewerNotes, "bulk:hidden:not_requested_public");
      issues.push(issueForPosition("review", "hidden", "not_requested_public", "Draft record did not request public publication and remains hidden.", draftPosition ?? position));
      continue;
    }

    if (context.duplicatePublicIds.has(position.draftPositionId)) {
      position.status = "reviewed";
      position.publicationStatus = "hidden";
      position.reviewerNotes = appendNote(position.reviewerNotes, "bulk:hidden:duplicate_public_claim");
      issues.push(issueForPosition("review", "hidden", "duplicate_public_claim", "Duplicate public source/race/entity/kind claim classified as hidden instead of public.", draftPosition ?? position));
      continue;
    }

    if (reason) {
      position.status = "rejected";
      position.publicationStatus = "hidden";
      position.reviewerNotes = appendNote(position.reviewerNotes, `bulk:rejected:${reason.reasonCode}`);
      issues.push(issueForPosition("review", "rejected", reason.reasonCode, reason.message, draftPosition ?? position));
      continue;
    }

    position.status = "verified";
    position.publicationStatus = "public";
    position.reviewerNotes = appendNote(position.reviewerNotes, "bulk:verified:public");
  }

  review.status = review.positions.some((position) => position.publicationStatus === "public") ? "ready" : review.positions.some((position) => position.status === "rejected" || position.status === "reviewed") ? "partially-ready" : "prepared";
  return issues;
}

function firstGateFailure(position: PositionReviewFile["positions"][number], draftPosition: DraftPosition | undefined, validationIssues: ExtractionValidationIssue[], context: { race: Race; sourceIds: Set<string>; entityIds: Set<string> }, evidenceById: Map<string, unknown>): { reasonCode: string; message: string } | null {
  if (!draftPosition) return { reasonCode: "missing_draft_position", message: "Review record does not map to a draft position." };
  if (!context.sourceIds.has(draftPosition.sourceId)) return { reasonCode: "unknown_source_id", message: "Draft sourceId is not known public data." };
  if (!context.entityIds.has(draftPosition.entityId)) return { reasonCode: "unknown_entity_id", message: "Draft entityId is not known public data." };
  if (!context.race.sourceIds.includes(draftPosition.sourceId)) return { reasonCode: "source_not_in_race", message: "Draft sourceId is not mapped to this race." };
  if (!context.race.entityIds.includes(draftPosition.entityId)) return { reasonCode: "entity_not_in_race", message: "Draft entityId is not mapped to this race." };
  if (validationIssues.some((issue) => issue.severity === "error")) return { reasonCode: validationIssues.find((issue) => issue.severity === "error")?.code ?? "draft_validation_error", message: "Draft validation failed for this position or its evidence." };
  if (!SUPPORTED_POSITION_KINDS.has(draftPosition.kind)) return { reasonCode: "unsupported_position_kind", message: "Draft position kind is unsupported." };
  if (!Array.isArray(draftPosition.evidenceIds) || draftPosition.evidenceIds.length === 0 || position.evidence.length === 0) return { reasonCode: "missing_evidence", message: "Public records require non-empty evidenceIds and evidence." };
  if (!PUBLIC_REVIEW_STATUSES.has(draftPosition.reviewStatus) && draftPosition.manualOverride?.status !== "verified") return { reasonCode: "unreviewed_publication", message: "Public records require reviewed, verified, published, or verified manual override status." };
  for (const evidenceId of draftPosition.evidenceIds) {
    if (!evidenceById.has(evidenceId)) return { reasonCode: "missing_evidence_reference", message: `Evidence '${evidenceId}' is missing from the draft evidence array.` };
  }
  for (const evidence of position.evidence) {
    if (!evidence.artifactId || !evidence.chunkId || !evidence.url) return { reasonCode: "missing_evidence_provenance", message: "Evidence must include artifactId, chunkId, and url provenance." };
    if (!evidence.quote?.trim()) return { reasonCode: "missing_quote", message: "Evidence must include an exact non-empty quote." };
  }
  return null;
}

function wantsPublicPublication(position: DraftPosition): boolean {
  return position.publicReady === true || position.publicationStatus === "public" || position.manualOverride?.publicationStatus === "public";
}

function findDuplicatePublicClaimPositionIds(positions: DraftPosition[]): Set<string> {
  const firstByClaim = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const position of positions) {
    if (!wantsPublicPublication(position)) continue;
    const claim = [position.raceId, position.sourceId, position.entityId, position.kind].join("|");
    const first = firstByClaim.get(claim);
    if (first) {
      duplicates.add(position.id);
    } else {
      firstByClaim.set(claim, position.id);
    }
  }
  return duplicates;
}

function indexValidationIssues(validationIssues: ExtractionValidationIssue[], draft: ExtractionDraft): Map<string, ExtractionValidationIssue[]> {
  const byPosition = new Map<string, ExtractionValidationIssue[]>();
  const evidenceToPosition = new Map((draft.evidence ?? []).map((evidence) => [evidence.id, evidence.positionId]));
  validationIssues.forEach((issue) => {
    const direct = positionIdFromPath(issue.path, draft.positions ?? []);
    const evidencePositionId = typeof issue.path === "string" ? evidenceToPosition.get(evidenceIdFromPath(issue.path, draft.evidence ?? [])) : undefined;
    const contextPosition = direct ?? evidencePositionId ?? findPositionByIssueContext(issue, draft);
    if (!contextPosition) return;
    const list = byPosition.get(contextPosition) ?? [];
    list.push(issue);
    byPosition.set(contextPosition, list);
  });
  return byPosition;
}

function positionIdFromPath(issuePath: string, positions: DraftPosition[]): string | undefined {
  const match = issuePath.match(/^positions\[(\d+)\]/);
  if (!match) return undefined;
  return positions[Number(match[1])]?.id;
}

function evidenceIdFromPath(issuePath: string, evidence: ExtractionDraft["evidence"]): string {
  const match = issuePath.match(/^evidence\[(\d+)\]/);
  return match ? evidence[Number(match[1])]?.id : "";
}

function findPositionByIssueContext(issue: ExtractionValidationIssue, draft: ExtractionDraft): string | undefined {
  if (issue.raceId || issue.sourceId || issue.entityId) {
    return draft.positions.find((position) => (!issue.raceId || position.raceId === issue.raceId) && (!issue.sourceId || position.sourceId === issue.sourceId) && (!issue.entityId || position.entityId === issue.entityId))?.id;
  }
  return undefined;
}

async function readDraft(filePath: string, issues: BulkReviewIssue[]): Promise<ExtractionDraft | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as ExtractionDraft;
  } catch (error) {
    issues.push(bulkIssue("read", "error", error instanceof SyntaxError ? "malformed_draft_json" : "missing_draft_file", filePath, `Unable to read extraction draft: ${sanitizeError(error)}`));
    return null;
  }
}

function buildDiagnostics(args: { ok: boolean; generatedAt: string; checkedFiles: Set<string>; draftPath: string; diagnosticsPath: string; positions: number; races: BulkRaceResult[]; issues: BulkReviewIssue[] }): BulkReviewDiagnostics {
  const publicCount = args.races.reduce((sum, race) => sum + race.counts.public, 0);
  const hiddenCount = args.races.reduce((sum, race) => sum + race.counts.hidden, 0);
  const rejectedCount = args.races.reduce((sum, race) => sum + race.counts.rejected, 0);
  const publishedCount = args.races.reduce((sum, race) => sum + race.publicPositionIds.length, 0);
  const allIssues = args.issues.sort((left, right) => `${left.phase}:${left.path}:${left.reasonCode}`.localeCompare(`${right.phase}:${right.path}:${right.reasonCode}`));
  return {
    ok: args.ok,
    generatedAt: args.generatedAt,
    checkedFiles: [...args.checkedFiles].map(relative).sort(),
    sourceDraftPath: relative(args.draftPath),
    diagnosticsPath: relative(args.diagnosticsPath),
    counts: {
      positions: args.positions,
      races: args.races.length,
      published: publishedCount,
      public: publicCount,
      hidden: hiddenCount,
      rejected: rejectedCount,
      errors: allIssues.filter((issue) => issue.status === "error").length,
      issues: allIssues.length,
    },
    races: args.races,
    issues: allIssues,
  };
}

async function writeDiagnostics(filePath: string, diagnostics: BulkReviewDiagnostics): Promise<BulkReviewDiagnostics> {
  await writeJson(filePath, diagnostics);
  return diagnostics;
}

async function preflightPublish(args: { raceSlug: string; options: BulkReviewOptions; now: () => Date }): Promise<ReviewWorkflowResult> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-bulk-review-preflight-"));
  const reviewsDir = path.join(root, "reviews");
  const overridesDir = path.join(root, "overrides");
  await copyDirectory(args.options.reviewsDir ?? DEFAULT_REVIEWS_DIR, reviewsDir);
  await copyDirectory(args.options.overridesDir ?? DEFAULT_OVERRIDES_DIR, overridesDir);
  return publishPositionReview({ raceSlug: args.raceSlug, reviewsDir, overridesDir, publicDir: args.options.publicDir, now: args.now });
}

async function copyDirectory(from: string, to: string): Promise<void> {
  try {
    await fs.cp(from, to, { recursive: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await fs.mkdir(to, { recursive: true });
      return;
    }
    throw error;
  }
}

function hidePublicReviewPositions(review: PositionReviewFile, reasonCode: string): void {
  for (const position of review.positions) {
    if (position.publicationStatus !== "public") continue;
    position.status = "reviewed";
    position.publicationStatus = "hidden";
    position.reviewerNotes = appendNote(position.reviewerNotes, `bulk:hidden:${reasonCode}`);
  }
  review.status = review.positions.some((position) => position.status !== "draft") ? "partially-ready" : "prepared";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function reviewRaceResult(race: Race, raceSlug: string, review: PositionReviewFile, options: BulkReviewOptions, status: BulkRaceResult["status"], publicPositionIds: string[], raceIssues: BulkReviewIssue[]): BulkRaceResult {
  return {
    raceSlug,
    raceId: race.id,
    reviewPath: relative(raceReviewPath(raceSlug, options.reviewsDir)),
    overridePath: relative(raceOverridePath(raceSlug, options.overridesDir)),
    status,
    counts: {
      positions: review.positions.length,
      public: review.positions.filter((position) => position.publicationStatus === "public").length,
      hidden: review.positions.filter((position) => position.publicationStatus !== "public" && position.status !== "rejected").length,
      rejected: review.positions.filter((position) => position.status === "rejected").length,
      issues: raceIssues.length,
      errors: raceIssues.filter((issue) => issue.status === "error").length,
    },
    publicPositionIds,
    issueCodes: [...new Set(raceIssues.map((issue) => issue.reasonCode))].sort(),
  };
}

function resultFromWorkflow(race: Race, workflow: ReviewWorkflowResult, status: BulkRaceResult["status"], publicPositionIds: string[], raceIssues: BulkReviewIssue[]): BulkRaceResult {
  return {
    raceSlug: workflow.raceSlug,
    raceId: race.id,
    reviewPath: workflow.reviewPath,
    overridePath: workflow.overridePath,
    status,
    counts: {
      positions: workflow.counts.positions,
      public: workflow.counts.ready,
      hidden: workflow.counts.hidden,
      rejected: workflow.counts.rejected,
      issues: raceIssues.length,
      errors: raceIssues.filter((issue) => issue.status === "error").length,
    },
    publicPositionIds,
    issueCodes: [...new Set(raceIssues.map((issue) => issue.reasonCode))].sort(),
  };
}

function emptyRaceResult(race: Race, raceSlug: string, options: BulkReviewOptions, status: BulkRaceResult["status"], raceIssues: BulkReviewIssue[]): BulkRaceResult {
  return {
    raceSlug,
    raceId: race.id,
    reviewPath: relative(raceReviewPath(raceSlug, options.reviewsDir)),
    overridePath: relative(raceOverridePath(raceSlug, options.overridesDir)),
    status,
    counts: { positions: 0, public: 0, hidden: 0, rejected: 0, issues: raceIssues.length, errors: raceIssues.filter((issue) => issue.status === "error").length },
    publicPositionIds: [],
    issueCodes: [...new Set(raceIssues.map((issue) => issue.reasonCode))].sort(),
  };
}

function fromReviewIssue(issue: ReviewIssue, race: Race, raceSlug: string): BulkReviewIssue {
  return bulkIssue(issue.phase === "load" ? "load" : issue.phase, issue.severity === "error" ? "error" : "hidden", issue.code, issue.path, issue.message, { raceId: race.id, raceSlug });
}

function dataLoadBulkIssue(error: unknown, phase: BulkReviewIssuePhase, race: Race, raceSlug: string): BulkReviewIssue | null {
  if (!(error instanceof DataLoadError)) return null;
  return bulkIssue(phase, "error", "data_load_error", error.sourcePath ?? error.phase, `DataLoadError during ${error.phase}: ${error.message}`, { raceId: race.id, raceSlug });
}

function issueForPosition(phase: BulkReviewIssuePhase, status: BulkReviewIssueStatus, reasonCode: string, message: string, position: Partial<DraftPosition> & { id?: string; draftPositionId?: string }): BulkReviewIssue {
  return bulkIssue(phase, status, reasonCode, position.id ?? position.draftPositionId ?? "position", message, {
    raceId: typeof position.raceId === "string" ? position.raceId : undefined,
    sourceId: typeof position.sourceId === "string" ? position.sourceId : undefined,
    entityId: typeof position.entityId === "string" ? position.entityId : undefined,
    positionId: position.id ?? position.draftPositionId,
  });
}

function bulkIssue(phase: BulkReviewIssuePhase, status: BulkReviewIssueStatus, reasonCode: string, issuePath: string, message: string, context: Partial<BulkReviewIssue> = {}): BulkReviewIssue {
  return {
    phase,
    status,
    reasonCode,
    path: relative(issuePath),
    message: sanitizeMessage(message),
    raceId: context.raceId,
    raceSlug: context.raceSlug,
    sourceId: context.sourceId,
    entityId: context.entityId,
    artifactId: context.artifactId,
    chunkId: context.chunkId,
    positionId: context.positionId,
    evidenceId: context.evidenceId,
  };
}

function appendNote(existing: string | undefined, note: string): string {
  const parts = (existing ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!parts.includes(note)) parts.push(note);
  return parts.join("\n");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function raceReviewPath(slug: string, reviewsDir = DEFAULT_REVIEWS_DIR): string {
  return path.join(reviewsDir, "races", `${slug}.json`);
}

function raceOverridePath(slug: string, overridesDir = DEFAULT_OVERRIDES_DIR): string {
  return path.join(overridesDir, "races", `${slug}.json`);
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? sanitizeMessage(error.message) : sanitizeMessage(String(error));
}

function sanitizeMessage(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/OPENAI_API_KEY=\S+/g, "OPENAI_API_KEY=[REDACTED]").replace(/\s+/g, " ").trim();
}

function relative(filePath: string): string {
  return path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) || filePath : filePath;
}
