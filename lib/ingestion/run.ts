import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanReadableText } from "./clean";
import { chunkArtifactText, normalizeFixturePath, validateKebabCaseId } from "./chunk";
import type {
  ArtifactChunk,
  IngestedArtifact,
  IngestionInputKind,
  IngestionManifest,
  IngestionRunCounts,
  IngestionRunPhase,
  IngestionRunPhaseSummary,
  IngestionRunSummary,
  IngestionTarget,
  IngestionTargetMode,
  IngestionTargetSummary,
  IngestionValidationIssue,
} from "./types";

export interface RunIngestionOptions {
  manifestPath: string;
  outDir: string;
  onlySource?: string;
  allowNetwork?: boolean;
  fixtureRoot?: string;
  fetchTimeoutMs?: number;
  maxInputBytes?: number;
  now?: () => Date;
}

export interface RunIngestionResult {
  summary: IngestionRunSummary;
  runPath: string;
  ok: boolean;
}

interface RawCapture {
  body: string;
  rawPath: string;
  mode: IngestionTargetMode;
}

const DEFAULT_FIXTURE_ROOT = "data/ingestion/fixtures";
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_INPUT_BYTES = 1_000_000;
const MIN_CLEAN_TEXT_LENGTH = 80;
const ACCEPTED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export async function runIngestion(options: RunIngestionOptions): Promise<RunIngestionResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const outRoot = path.resolve(options.outDir);
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const phases: IngestionRunPhaseSummary[] = [];
  const targetSummaries: IngestionTargetSummary[] = [];
  const artifacts: IngestedArtifact[] = [];
  const issues: IngestionValidationIssue[] = [];
  let chunkCount = 0;

  await mkdir(outRoot, { recursive: true });

  const runId = stableRunId(startedAt);
  let manifest: IngestionManifest | undefined;
  try {
    phases.push(phase("manifest", "running", "Loading ingestion manifest."));
    manifest = await loadManifest(options.manifestPath, maxInputBytes);
    const manifestIssues = validateManifest(manifest, options.manifestPath);
    issues.push(...manifestIssues);

    if (manifestIssues.some((issue) => issue.severity === "error")) {
      phases.push(phase("manifest", "failed", "Manifest validation failed."));
      return await finalize({
        outRoot,
        runId,
        startedAt,
        completedAt: now().toISOString(),
        phases,
        targets: targetSummaries,
        artifacts,
        chunkCount,
        issues,
      });
    }

    phases.push(phase("manifest", "complete", `Loaded ${manifest.targets.length} targets.`));
  } catch (error) {
    phases.push(phase("manifest", "failed", "Could not load ingestion manifest."));
    issues.push(issue("manifest_load_failed", "error", options.manifestPath, sanitizeError(error)));
    return await finalize({
      outRoot,
      runId,
      startedAt,
      completedAt: now().toISOString(),
      phases,
      targets: targetSummaries,
      artifacts,
      chunkCount,
      issues,
    });
  }

  const selectedTargets = selectTargets(manifest.targets, options.onlySource);
  if (selectedTargets.length === 0) {
    issues.push(
      issue(
        "no_matching_targets",
        "error",
        "targets",
        options.onlySource ? `No manifest targets matched --only-source ${options.onlySource}.` : "No manifest targets found.",
      ),
    );
  }

  for (const target of selectedTargets) {
    const targetSummary: IngestionTargetSummary = {
      targetId: target.id,
      sourceId: target.sourceId,
      artifactId: target.artifactId,
      fetchStatus: "pending",
      importStatus: "pending",
    };
    targetSummaries.push(targetSummary);

    try {
      const capture = await captureTarget(target, {
        allowNetwork: options.allowNetwork ?? false,
        fixtureRoot: options.fixtureRoot ?? DEFAULT_FIXTURE_ROOT,
        fetchTimeoutMs: options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
        maxInputBytes,
        outRoot,
      });
      targetSummary.fetchStatus = capture.mode === "url" ? "fetched" : "skipped";
      targetSummary.rawPath = capture.rawPath;
      phases.push(phase("fetch", "complete", `Captured ${target.sourceId}.`, target));

      const cleaned = cleanReadableText(capture.body, {
        inputKind: target.inputKind,
        path: capture.rawPath,
        minTextLength: MIN_CLEAN_TEXT_LENGTH,
      });
      const cleanIssues = cleaned.issues.map((cleanIssue) => ({
        ...cleanIssue,
        sourceId: target.sourceId,
        artifactId: target.artifactId,
      }));
      issues.push(...cleanIssues);

      if (cleanIssues.some((cleanIssue) => cleanIssue.severity === "error" || cleanIssue.code === "low_text")) {
        targetSummary.importStatus = "failed";
        artifacts.push(failedArtifact(target, capture.rawPath, cleanIssues, now().toISOString()));
        phases.push(phase("clean", "failed", `Clean text failed for ${target.sourceId}.`, target));
        continue;
      }

      phases.push(phase("clean", "complete", `Cleaned ${target.sourceId}.`, target));
      const chunks = chunkArtifactText({
        sourceId: target.sourceId,
        artifactId: target.artifactId,
        text: cleaned.text,
      });
      phases.push(phase("chunk", "complete", `Created ${chunks.length} chunks for ${target.sourceId}.`, target));

      const rawPath = capture.rawPath;
      const outputStem = outputStemForTarget(target);
      const cleanPath = safeOutputPath(outRoot, "artifacts", `${outputStem}.json`);
      const chunkPath = safeOutputPath(outRoot, "chunks", `${outputStem}.json`);
      const artifact: IngestedArtifact = {
        id: target.artifactId,
        sourceId: target.sourceId,
        targetId: target.id,
        title: target.title,
        url: target.canonicalUrl,
        status: "chunked",
        inputKind: target.inputKind,
        capturedAt: now().toISOString(),
        rawPath: relativePath(rawPath),
        cleanPath: relativePath(cleanPath),
        chunkPath: relativePath(chunkPath),
        text: cleaned.text,
        metadata: cleaned.metadata,
        issues: cleanIssues,
      };

      await writeJson(cleanPath, artifact);
      await writeJson(chunkPath, chunks);
      targetSummary.importStatus = "imported";
      targetSummary.cleanPath = relativePath(cleanPath);
      targetSummary.chunkPath = relativePath(chunkPath);
      artifacts.push(artifact);
      chunkCount += chunks.length;
      phases.push(phase("write", "complete", `Wrote ingestion artifacts for ${target.sourceId}.`, target));
    } catch (error) {
      const diagnostic = issue("target_ingest_failed", "error", `targets.${target.id}`, sanitizeError(error), target);
      issues.push(diagnostic);
      targetSummary.fetchStatus = targetSummary.fetchStatus === "pending" ? "failed" : targetSummary.fetchStatus;
      targetSummary.importStatus = "failed";
      artifacts.push(failedArtifact(target, targetSummary.rawPath, [diagnostic], now().toISOString()));
      phases.push(phase("fetch", "failed", diagnostic.message, target));
    }
  }

  return await finalize({
    outRoot,
    runId,
    startedAt,
    completedAt: now().toISOString(),
    phases,
    targets: targetSummaries,
    artifacts,
    chunkCount,
    issues,
  });
}

interface FinalizeInput {
  outRoot: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  phases: IngestionRunPhaseSummary[];
  targets: IngestionTargetSummary[];
  artifacts: IngestedArtifact[];
  chunkCount: number;
  issues: IngestionValidationIssue[];
}

async function finalize(input: FinalizeInput): Promise<RunIngestionResult> {
  const usableArtifacts = input.artifacts.filter((artifact) => artifact.status === "chunked").length;
  const counts = countRun(input.targets.length, usableArtifacts, input.chunkCount, input.issues);
  const summary: IngestionRunSummary = {
    id: input.runId,
    status: counts.errors > 0 || usableArtifacts === 0 ? "failed" : "complete",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    phases: input.phases,
    targets: input.targets,
    artifacts: input.artifacts,
    counts,
    issues: input.issues,
  };
  const runPath = safeOutputPath(input.outRoot, "runs", "latest.json");
  await writeJson(runPath, summary);
  return { summary, runPath: relativePath(runPath), ok: summary.status === "complete" };
}

async function loadManifest(manifestPath: string, maxBytes: number): Promise<IngestionManifest> {
  const body = await readBoundedFile(manifestPath, maxBytes);
  return JSON.parse(body) as IngestionManifest;
}

function validateManifest(manifest: unknown, manifestPath: string): IngestionValidationIssue[] {
  const issues: IngestionValidationIssue[] = [];
  if (!isRecord(manifest)) {
    return [issue("invalid_manifest", "error", manifestPath, "Manifest must be a JSON object.")];
  }

  if (manifest.version !== 1) {
    issues.push(issue("invalid_manifest_version", "error", `${manifestPath}.version`, "Manifest version must be 1."));
  }

  if (typeof manifest.description !== "string" || manifest.description.trim().length === 0) {
    issues.push(issue("invalid_manifest_description", "error", `${manifestPath}.description`, "Manifest description is required."));
  }

  if (!Array.isArray(manifest.targets)) {
    issues.push(issue("invalid_manifest_targets", "error", `${manifestPath}.targets`, "Manifest targets must be an array."));
    return issues;
  }

  manifest.targets.forEach((target, index) => {
    const targetPath = `${manifestPath}.targets[${index}]`;
    if (!isRecord(target)) {
      issues.push(issue("invalid_target", "error", targetPath, "Target must be an object."));
      return;
    }

    for (const field of ["id", "sourceId", "artifactId", "title", "inputKind", "fixturePath", "canonicalUrl"] as const) {
      if (typeof target[field] !== "string" || target[field].trim().length === 0) {
        issues.push(issue("invalid_target_field", "error", `${targetPath}.${field}`, "Required string field is missing."));
      }
    }

    if (typeof target.sampleFixture !== "boolean") {
      issues.push(issue("invalid_target_field", "error", `${targetPath}.sampleFixture`, "sampleFixture must be a boolean."));
    }

    if (typeof target.inputKind === "string" && !["html", "text"].includes(target.inputKind)) {
      issues.push(issue("invalid_input_kind", "error", `${targetPath}.inputKind`, "inputKind must be html or text."));
    }

    if (typeof target.mode === "string" && !["fixture", "url"].includes(target.mode)) {
      issues.push(issue("invalid_target_mode", "error", `${targetPath}.mode`, "mode must be fixture or url."));
    }

    for (const field of ["id", "sourceId", "artifactId"] as const) {
      if (typeof target[field] === "string") {
        issues.push(...validateKebabCaseId(target[field], `${targetPath}.${field}`));
      }
    }

    if (typeof target.fixturePath === "string") {
      try {
        normalizeFixturePath(target.fixturePath);
      } catch (error) {
        issues.push(issue("invalid_fixture_path", "error", `${targetPath}.fixturePath`, sanitizeError(error)));
      }
    }
  });

  return issues;
}

function selectTargets(targets: IngestionTarget[], onlySource: string | undefined): IngestionTarget[] {
  if (!onlySource) {
    return targets;
  }

  return targets.filter((target) => target.sourceId === onlySource || target.id === onlySource || target.artifactId === onlySource);
}

interface CaptureOptions {
  allowNetwork: boolean;
  fixtureRoot: string;
  fetchTimeoutMs: number;
  maxInputBytes: number;
  outRoot: string;
}

async function captureTarget(target: IngestionTarget, options: CaptureOptions): Promise<RawCapture> {
  const mode = target.mode ?? "fixture";
  const extension = extensionForTarget(target);
  const rawPath = safeOutputPath(options.outRoot, "raw", `${outputStemForTarget(target)}${extension}`);
  let body: string;

  if (mode === "url") {
    if (!options.allowNetwork) {
      throw new Error(`Network fetch disabled for ${target.sourceId}; pass --allow-network to fetch URL targets.`);
    }
    body = await fetchBounded(target.canonicalUrl, target.inputKind, options.fetchTimeoutMs, options.maxInputBytes);
  } else {
    const fixturePath = normalizeFixturePath(target.fixturePath, options.fixtureRoot);
    body = await readBoundedFile(fixturePath, options.maxInputBytes);
  }

  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, body, "utf8");
  return { body, rawPath: relativePath(rawPath), mode };
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<string> {
  const buffer = await readFile(filePath);
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Input exceeds ${maxBytes} byte limit: ${filePath}`);
  }
  return buffer.toString("utf8");
}

async function fetchBounded(url: string, inputKind: IngestionInputKind, timeoutMs: number, maxBytes: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching ${url}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!ACCEPTED_CONTENT_TYPES.some((accepted) => contentType.includes(accepted))) {
      throw new Error(`Unsupported content type for ${url}: ${contentType || "missing"}`);
    }

    if (inputKind === "html" && !contentType.includes("html") && !contentType.includes("text/plain")) {
      throw new Error(`Expected HTML-compatible content for ${url}: ${contentType || "missing"}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        throw new Error(`Fetched input exceeds ${maxBytes} byte limit: ${url}`);
      }
      return text;
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`Fetched input exceeds ${maxBytes} byte limit: ${url}`);
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Fetch timed out after ${timeoutMs}ms for ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeOutputPath(root: string, directory: "raw" | "artifacts" | "chunks" | "runs", fileName: string): string {
  const absoluteRoot = path.resolve(root);
  const outputPath = path.resolve(absoluteRoot, directory, fileName);
  if (outputPath !== absoluteRoot && !outputPath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Output path escapes configured root: ${directory}/${fileName}`);
  }
  return outputPath;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function failedArtifact(
  target: IngestionTarget,
  rawPath: string | undefined,
  targetIssues: IngestionValidationIssue[],
  capturedAt: string,
): IngestedArtifact {
  return {
    id: target.artifactId,
    sourceId: target.sourceId,
    targetId: target.id,
    title: target.title,
    url: target.canonicalUrl,
    status: "failed",
    inputKind: target.inputKind,
    capturedAt,
    rawPath,
    issues: targetIssues,
  };
}

function countRun(
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

function phase(
  phaseName: IngestionRunPhase,
  status: IngestionRunPhaseSummary["status"],
  message: string,
  target?: IngestionTarget,
): IngestionRunPhaseSummary {
  return {
    phase: phaseName,
    status,
    sourceId: target?.sourceId,
    artifactId: target?.artifactId,
    message,
  };
}

function issue(
  code: string,
  severity: IngestionValidationIssue["severity"],
  issuePath: string,
  message: string,
  target?: Pick<IngestionTarget, "sourceId" | "artifactId">,
): IngestionValidationIssue {
  return {
    code,
    severity,
    path: issuePath,
    message,
    sourceId: target?.sourceId,
    artifactId: target?.artifactId,
  };
}

function outputStemForTarget(target: IngestionTarget): string {
  return target.artifactId.replace(/^art-/, "src-");
}

function extensionForTarget(target: IngestionTarget): ".html" | ".txt" {
  if (target.inputKind === "text") {
    return ".txt";
  }
  return ".html";
}

function stableRunId(startedAt: string): string {
  return `run-${startedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
