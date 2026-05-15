import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  ArtifactChunk,
  IngestedArtifact,
  IngestionManifest,
  IngestionRunCounts,
  IngestionRunSummary,
  IngestionTarget,
  IngestionValidationIssue,
  IngestionValidationResult,
} from "./types";

export interface ValidateIngestionOptions {
  manifestPath: string;
  outDir: string;
  publicSourcesPath?: string;
  reportPath?: string;
}

interface PublicSourcesFile {
  sources?: Array<{ id?: unknown }>;
}

interface LoadedJson<T> {
  value?: T;
  ok: boolean;
}

interface IssueContext {
  sourceId?: string;
  artifactId?: string;
}

const DEFAULT_PUBLIC_SOURCES_PATH = "data/public/sources.json";
const MIN_NORMALIZED_TEXT_LENGTH = 80;

export async function validateIngestion(options: ValidateIngestionOptions): Promise<IngestionValidationResult> {
  const outRoot = path.resolve(options.outDir);
  const checkedFiles = new Set<string>();
  const issues: IngestionValidationIssue[] = [];

  const manifestLoad = await readJson<IngestionManifest>(options.manifestPath, checkedFiles, issues, "manifest_json_malformed");
  const publicSourcesLoad = await readJson<PublicSourcesFile>(
    options.publicSourcesPath ?? DEFAULT_PUBLIC_SOURCES_PATH,
    checkedFiles,
    issues,
    "public_sources_json_malformed",
  );
  const runPath = path.join(outRoot, "runs/latest.json");
  const runLoad = await readJson<IngestionRunSummary>(runPath, checkedFiles, issues, "run_summary_json_malformed");

  const manifest = manifestLoad.value;
  const publicSourceIds = new Set(
    Array.isArray(publicSourcesLoad.value?.sources)
      ? publicSourcesLoad.value.sources.map((source) => source.id).filter((id): id is string => typeof id === "string")
      : [],
  );
  const runSummary = runLoad.value;

  if (!manifest || !Array.isArray(manifest.targets)) {
    issues.push(issue("invalid_manifest_targets", "error", options.manifestPath, "Manifest targets must be an array."));
  }

  if (publicSourcesLoad.value && !Array.isArray(publicSourcesLoad.value.sources)) {
    issues.push(issue("invalid_public_sources", "error", options.publicSourcesPath ?? DEFAULT_PUBLIC_SOURCES_PATH, "Public sources file must contain a sources array."));
  }

  if (runSummary) {
    validateRunSummary(runSummary, runPath, issues);
  }

  const artifactCount = { value: 0 };
  const chunkCount = { value: 0 };

  for (const [index, target] of (manifest?.targets ?? []).entries()) {
    const targetPath = `${options.manifestPath}.targets[${index}]`;
    validateTargetMetadata(target, targetPath, publicSourceIds, issues);

    const artifactPath = targetOutputPath(outRoot, "artifacts", target, ".json");
    const chunkPath = targetOutputPath(outRoot, "chunks", target, ".json");
    const rawPath = targetOutputPath(outRoot, "raw", target, rawExtension(target));

    checkedFiles.add(relativePath(rawPath));
    if (!existsSync(rawPath)) {
      issues.push(issue("missing_raw_capture", "error", relativePath(rawPath), "Expected raw capture file is missing.", target));
    }

    const artifactLoad = await readJson<IngestedArtifact>(artifactPath, checkedFiles, issues, "artifact_json_malformed", target);
    const chunksLoad = await readJson<ArtifactChunk[]>(chunkPath, checkedFiles, issues, "chunk_json_malformed", target);

    if (artifactLoad.value) {
      artifactCount.value += 1;
      validateArtifact(artifactLoad.value, artifactPath, rawPath, chunkPath, target, publicSourceIds, issues);
    }

    if (chunksLoad.value) {
      validateChunks(chunksLoad.value, chunkPath, target, artifactLoad.value, issues);
      chunkCount.value += Array.isArray(chunksLoad.value) ? chunksLoad.value.length : 0;
    }
  }

  if (runSummary) {
    validateRunReferences(runSummary, outRoot, manifest?.targets ?? [], checkedFiles, issues);
    validateRunCounts(runSummary, artifactCount.value, chunkCount.value, issues, runPath);
  }

  const counts = countValidation(manifest?.targets.length ?? 0, artifactCount.value, chunkCount.value, issues);
  return {
    ok: counts.errors === 0,
    checkedFiles: Array.from(checkedFiles).sort(),
    counts,
    issues: issues.sort(compareIssues),
  };
}

export async function writeValidationReport(reportPath: string, result: IngestionValidationResult): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function validateTargetMetadata(
  target: IngestionTarget,
  targetPath: string,
  publicSourceIds: Set<string>,
  issues: IngestionValidationIssue[],
): void {
  if (!publicSourceIds.has(target.sourceId)) {
    issues.push(issue("unknown_source_id", "error", `${targetPath}.sourceId`, `sourceId ${target.sourceId} is not present in data/public/sources.json.`, target));
  }

  if (typeof target.canonicalUrl !== "string" || target.canonicalUrl.trim().length === 0) {
    issues.push(issue("missing_canonical_url", "error", `${targetPath}.canonicalUrl`, "Target must include canonicalUrl metadata.", target));
  }

  if ((target.mode ?? "fixture") === "fixture" && (!target.fixturePath || target.fixturePath.trim().length === 0)) {
    issues.push(issue("missing_fixture_path", "error", `${targetPath}.fixturePath`, "Fixture targets must include fixturePath metadata.", target));
  }
}

function validateArtifact(
  artifact: IngestedArtifact,
  artifactPath: string,
  rawPath: string,
  chunkPath: string,
  target: IngestionTarget,
  publicSourceIds: Set<string>,
  issues: IngestionValidationIssue[],
): void {
  const displayPath = relativePath(artifactPath);
  if (artifact.id !== target.artifactId) {
    issues.push(issue("artifact_id_mismatch", "error", `${displayPath}.id`, `Expected artifact id ${target.artifactId}.`, target));
  }
  if (artifact.sourceId !== target.sourceId) {
    issues.push(issue("artifact_source_mismatch", "error", `${displayPath}.sourceId`, `Expected sourceId ${target.sourceId}.`, target));
  }
  if (!publicSourceIds.has(artifact.sourceId)) {
    issues.push(issue("unknown_source_id", "error", `${displayPath}.sourceId`, `sourceId ${artifact.sourceId} is not present in data/public/sources.json.`, { sourceId: artifact.sourceId, artifactId: artifact.id }));
  }
  if (artifact.targetId !== target.id) {
    issues.push(issue("artifact_target_mismatch", "error", `${displayPath}.targetId`, `Expected targetId ${target.id}.`, target));
  }
  if (artifact.status !== "chunked") {
    issues.push(issue("artifact_not_chunked", "error", `${displayPath}.status`, "Artifact must have status chunked for S04 consumption.", target));
  }
  if (artifact.url !== target.canonicalUrl) {
    issues.push(issue("artifact_url_mismatch", "error", `${displayPath}.url`, "Artifact URL must match manifest canonicalUrl.", target));
  }
  if (artifact.rawPath !== relativePath(rawPath)) {
    issues.push(issue("artifact_raw_path_mismatch", "error", `${displayPath}.rawPath`, `Expected ${relativePath(rawPath)}.`, target));
  }
  if (artifact.chunkPath !== relativePath(chunkPath)) {
    issues.push(issue("artifact_chunk_path_mismatch", "error", `${displayPath}.chunkPath`, `Expected ${relativePath(chunkPath)}.`, target));
  }
  if (typeof artifact.text !== "string" || artifact.text.trim().length === 0) {
    issues.push(issue("empty_clean_text", "error", `${displayPath}.text`, "Artifact normalized text must be non-empty.", target));
  } else if (artifact.text.trim().length < MIN_NORMALIZED_TEXT_LENGTH) {
    issues.push(issue("low_clean_text", "error", `${displayPath}.text`, `Artifact normalized text must be at least ${MIN_NORMALIZED_TEXT_LENGTH} characters.`, target));
  }
  if (artifact.metadata?.lowText === true) {
    issues.push(issue("low_clean_text", "error", `${displayPath}.metadata.lowText`, "Artifact metadata marks text as too short.", target));
  }
}

function validateChunks(
  chunks: ArtifactChunk[],
  chunkPath: string,
  target: IngestionTarget,
  artifact: IngestedArtifact | undefined,
  issues: IngestionValidationIssue[],
): void {
  const displayPath = relativePath(chunkPath);
  if (!Array.isArray(chunks)) {
    issues.push(issue("invalid_chunk_file", "error", displayPath, "Chunk file must be a JSON array.", target));
    return;
  }
  if (chunks.length === 0) {
    issues.push(issue("empty_chunk_file", "error", displayPath, "Chunk file must contain at least one chunk.", target));
    return;
  }

  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();

  chunks.forEach((chunk, index) => {
    const chunkItemPath = `${displayPath}[${index}]`;
    if (chunk.artifactId !== target.artifactId) {
      issues.push(issue("chunk_artifact_mismatch", "error", `${chunkItemPath}.artifactId`, `Expected artifactId ${target.artifactId}.`, target));
    }
    if (chunk.sourceId !== target.sourceId) {
      issues.push(issue("chunk_source_mismatch", "error", `${chunkItemPath}.sourceId`, `Expected sourceId ${target.sourceId}.`, target));
    }
    const expectedId = `${target.artifactId}-chunk-${String(index + 1).padStart(3, "0")}`;
    if (chunk.id !== expectedId) {
      issues.push(issue("chunk_id_mismatch", "error", `${chunkItemPath}.id`, `Expected chunk id ${expectedId}.`, target));
    }
    if (seenIds.has(chunk.id)) {
      issues.push(issue("duplicate_chunk_id", "error", `${chunkItemPath}.id`, `Duplicate chunk id ${chunk.id}.`, target));
    }
    seenIds.add(chunk.id);

    if (seenOrders.has(chunk.order)) {
      issues.push(issue("duplicate_chunk_order", "error", `${chunkItemPath}.order`, `Duplicate chunk order ${chunk.order}.`, target));
    }
    seenOrders.add(chunk.order);

    if (chunk.order !== index + 1) {
      issues.push(issue("chunk_order_gap", "error", `${chunkItemPath}.order`, `Expected contiguous order ${index + 1}.`, target));
    }
    if (typeof chunk.text !== "string" || chunk.text.trim().length === 0) {
      issues.push(issue("empty_chunk_text", "error", `${chunkItemPath}.text`, "Chunk text must be non-empty.", target));
    }
    if (chunk.charCount !== chunk.text.length) {
      issues.push(issue("chunk_char_count_mismatch", "error", `${chunkItemPath}.charCount`, "charCount must equal text length.", target));
    }
    if (chunk.startOffset < 0 || chunk.endOffset <= chunk.startOffset) {
      issues.push(issue("invalid_chunk_offsets", "error", `${chunkItemPath}.startOffset`, "Chunk offsets must be positive and increasing.", target));
    }
    if (artifact?.text && !artifact.text.includes(chunk.text)) {
      issues.push(issue("chunk_text_not_in_artifact", "error", `${chunkItemPath}.text`, "Chunk text must come from the artifact normalized text.", target));
    }
  });
}

function validateRunSummary(runSummary: IngestionRunSummary, runPath: string, issues: IngestionValidationIssue[]): void {
  const displayPath = relativePath(runPath);
  if (runSummary.status === "failed") {
    issues.push(issue("run_summary_failed", "error", `${displayPath}.status`, "Latest ingestion run status is failed."));
  }
  for (const [index, phase] of (runSummary.phases ?? []).entries()) {
    if (phase.status === "failed") {
      issues.push(issue("run_phase_failed", "error", `${displayPath}.phases[${index}].status`, phase.message ?? "Run phase failed.", phase));
    }
  }
  for (const [index, target] of (runSummary.targets ?? []).entries()) {
    if (target.fetchStatus === "failed" || target.importStatus === "failed") {
      issues.push(issue("run_target_failed", "error", `${displayPath}.targets[${index}]`, "Run target has failed fetch or import status.", target));
    }
  }
  for (const [index, diagnostic] of (runSummary.issues ?? []).entries()) {
    if (diagnostic.severity === "error") {
      issues.push(issue("run_issue_error", "error", `${displayPath}.issues[${index}]`, diagnostic.message, diagnostic));
    }
  }
}

function validateRunReferences(
  runSummary: IngestionRunSummary,
  outRoot: string,
  targets: IngestionTarget[],
  checkedFiles: Set<string>,
  issues: IngestionValidationIssue[],
): void {
  const expectedTargets = new Set(targets.map((target) => target.id));
  for (const [index, target] of (runSummary.targets ?? []).entries()) {
    const basePath = `${relativePath(path.join(outRoot, "runs/latest.json"))}.targets[${index}]`;
    if (!expectedTargets.has(target.targetId)) {
      issues.push(issue("run_target_stale", "error", `${basePath}.targetId`, `Run target ${target.targetId} is not present in manifest.`, target));
    }
    for (const field of ["rawPath", "cleanPath", "chunkPath"] as const) {
      const filePath = target[field];
      if (filePath) {
        checkedFiles.add(filePath);
        if (!existsSync(path.resolve(filePath))) {
          issues.push(issue("run_referenced_file_missing", "error", `${basePath}.${field}`, `Referenced file is missing: ${filePath}.`, target));
        }
      }
    }
  }
}

function validateRunCounts(
  runSummary: IngestionRunSummary,
  artifactCount: number,
  chunkCount: number,
  issues: IngestionValidationIssue[],
  runPath: string,
): void {
  const displayPath = relativePath(runPath);
  if (runSummary.counts?.targets !== runSummary.targets?.length) {
    issues.push(issue("run_count_mismatch", "error", `${displayPath}.counts.targets`, "Run target count must match targets array length."));
  }
  if (runSummary.counts?.artifacts !== artifactCount) {
    issues.push(issue("run_count_mismatch", "error", `${displayPath}.counts.artifacts`, `Run artifact count must match ${artifactCount} artifact files.`));
  }
  if (runSummary.counts?.chunks !== chunkCount) {
    issues.push(issue("run_count_mismatch", "error", `${displayPath}.counts.chunks`, `Run chunk count must match ${chunkCount} chunks.`));
  }
  if ((runSummary.counts?.errors ?? 0) > 0) {
    issues.push(issue("run_errors_recorded", "error", `${displayPath}.counts.errors`, "Latest ingestion run recorded errors."));
  }
}

async function readJson<T>(
  filePath: string,
  checkedFiles: Set<string>,
  issues: IngestionValidationIssue[],
  malformedCode: string,
  target?: IssueContext,
): Promise<LoadedJson<T>> {
  const displayPath = relativePath(filePath);
  checkedFiles.add(displayPath);
  try {
    const body = await readFile(filePath, "utf8");
    return { ok: true, value: JSON.parse(body) as T };
  } catch (error) {
    const code = isNotFound(error) ? "missing_generated_file" : malformedCode;
    issues.push(issue(code, "error", displayPath, sanitizeError(error), target));
    return { ok: false };
  }
}

function targetOutputPath(outRoot: string, directory: "raw" | "artifacts" | "chunks", target: IngestionTarget, extension: string): string {
  return path.join(outRoot, directory, `${outputStemForTarget(target)}${extension}`);
}

function outputStemForTarget(target: IngestionTarget): string {
  return target.artifactId.replace(/^art-/, "src-");
}

function rawExtension(target: IngestionTarget): ".html" | ".txt" {
  return target.inputKind === "text" ? ".txt" : ".html";
}

function countValidation(
  targets: number,
  artifacts: number,
  chunks: number,
  issues: IngestionValidationIssue[],
): IngestionRunCounts {
  return {
    targets,
    artifacts,
    chunks,
    issues: issues.length,
    errors: issues.filter((item) => item.severity === "error").length,
    warnings: issues.filter((item) => item.severity === "warning").length,
  };
}

function issue(
  code: string,
  severity: IngestionValidationIssue["severity"],
  issuePath: string,
  message: string,
  target?: IssueContext,
): IngestionValidationIssue {
  return {
    code,
    severity,
    path: issuePath,
    message: message.replace(/\s+/g, " ").trim(),
    sourceId: target?.sourceId,
    artifactId: target?.artifactId,
  };
}

function compareIssues(left: IngestionValidationIssue, right: IngestionValidationIssue): number {
  return `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`);
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/g, "/");
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, " ").trim();
  }
  return String(error).replace(/\s+/g, " ").trim();
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
