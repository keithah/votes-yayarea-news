import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanReadableText } from "../ingestion/clean";
import type { IngestionInputKind, IngestionManifest, IngestionTarget } from "../ingestion/types";
import type {
  AcquisitionCandidate,
  AcquisitionDiagnostic,
  AcquisitionLatestReport,
  AcquisitionResult,
  AcquisitionStatus,
  AcquireSourcesOptions,
} from "./types";

interface PublicSource {
  id: string;
  slug?: string;
  name?: string;
}

interface PublicSourcesFile {
  sources?: unknown;
}

interface CandidateFile {
  version?: unknown;
  candidates?: unknown;
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CANDIDATE_BYTES = 1_000_000;
const DEFAULT_MIN_TEXT_LENGTH = 80;
const ACQUISITION_FIXTURE_PREFIX = "data/acquisition/fixtures";
const ACCEPTED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

export async function acquireSources(options: AcquireSourcesOptions): Promise<AcquisitionResult> {
  const now = options.now ?? (() => new Date());
  const timestamp = now().toISOString();
  const diagnostics: AcquisitionDiagnostic[] = [];
  const maxCandidateBytes = options.maxCandidateBytes ?? DEFAULT_MAX_CANDIDATE_BYTES;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const minTextLength = options.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;

  let sources: PublicSource[] = [];
  let candidates: AcquisitionCandidate[] = [];

  try {
    sources = loadSources(await readBoundedFile(options.sourcesPath, maxCandidateBytes), options.sourcesPath);
  } catch (error) {
    diagnostics.push(diagnostic("unknown", "validate", "invalid_source", timestamp, false, {
      path: options.sourcesPath,
      error: { code: "source_load_failed", message: sanitizeError(error) },
    }));
    await writeLatest(options, timestamp, sources.length, candidates.length, diagnostics, undefined);
    return { ok: false, diagnostics };
  }

  try {
    candidates = loadCandidates(await readBoundedFile(options.candidatesPath, maxCandidateBytes), options.candidatesPath);
  } catch (error) {
    diagnostics.push(diagnostic("unknown", "candidate", "invalid_candidate", timestamp, false, {
      path: options.candidatesPath,
      error: { code: "candidate_load_failed", message: sanitizeError(error) },
    }));
    await writeLatest(options, timestamp, sources.length, candidates.length, diagnostics, undefined);
    return { ok: false, diagnostics };
  }

  const selectedSources = typeof options.maxSources === "number" ? sources.slice(0, options.maxSources) : sources;
  diagnostics.push(...validateSources(selectedSources, timestamp));
  diagnostics.push(...validateCandidates(candidates, selectedSources, timestamp));
  const fatalValidation = diagnostics.some((item) => item.status === "invalid_candidate" || item.status === "invalid_source");
  if (fatalValidation) {
    await writeLatest(options, timestamp, selectedSources.length, candidates.length, diagnostics, undefined);
    return { ok: false, diagnostics };
  }

  const candidatesBySource = new Map(candidates.map((candidate) => [candidate.sourceId, candidate]));
  const targets: IngestionTarget[] = [];

  for (const source of selectedSources) {
    const candidate = candidatesBySource.get(source.id);
    if (!candidate) {
      diagnostics.push(diagnostic(source.id, "candidate", "skipped", timestamp, false, {
        skippedReason: "No candidate URL registered for source.",
      }));
      continue;
    }

    const attemptedUrl = redactUrl(candidate.url);
    if (options.allowNetwork === false && !isLoopbackUrl(candidate.url)) {
      diagnostics.push(diagnostic(source.id, "fetch", "skipped", timestamp, false, {
        attemptedUrl,
        skippedReason: "Network fetch disabled; pass --allow-network to capture public candidate URLs.",
      }));
      continue;
    }

    try {
      const fetched = await fetchCandidate(candidate.url, fetchTimeoutMs, maxCandidateBytes);
      const inputKind = inferInputKind(fetched.contentType, candidate.url);
      const cleaned = cleanReadableText(fetched.body, {
        inputKind,
        path: attemptedUrl,
        minTextLength,
      });

      if (cleaned.issues.some((issue) => issue.code === "empty_text" || issue.code === "low_text" || issue.severity === "error")) {
        diagnostics.push(diagnostic(source.id, "capture", "low_text", timestamp, false, {
          attemptedUrl,
          error: { code: "low_text", message: `Readable text length ${cleaned.text.length} is below ${minTextLength}.` },
        }));
        continue;
      }

      const fixturePath = fixturePathFor(source, candidate, inputKind);
      const absoluteFixturePath = path.resolve(fixturePath);
      await mkdir(path.dirname(absoluteFixturePath), { recursive: true });
      await writeFile(absoluteFixturePath, fetched.body, "utf8");

      const target = targetFor(source, candidate, fixturePath, inputKind);
      targets.push(target);
      diagnostics.push(diagnostic(source.id, "capture", "captured", timestamp, true, {
        attemptedUrl,
        capturedArtifactPath: fixturePath,
      }));
    } catch (error) {
      const classified = classifyFetchError(error);
      diagnostics.push(diagnostic(source.id, "fetch", classified.status, timestamp, false, {
        attemptedUrl,
        error: { code: classified.code, message: sanitizeError(error) },
      }));
    }
  }

  const manifest: IngestionManifest = {
    version: 1,
    description: "Generated M004/S01 live acquisition manifest. Targets are captured public artifacts and are safe to ingest without network access.",
    targets,
  };

  const manifestDiagnostics = validateCapturedTargets(targets, diagnostics, timestamp);
  diagnostics.push(...manifestDiagnostics);
  if (manifestDiagnostics.length > 0) {
    await writeLatest(options, timestamp, selectedSources.length, candidates.length, diagnostics, undefined);
    return { ok: false, diagnostics };
  }

  await writeJson(options.manifestPath, manifest);
  const reportPath = await writeLatest(options, timestamp, selectedSources.length, candidates.length, diagnostics, manifest);
  return { ok: true, diagnostics, manifest, reportPath };
}

function loadSources(body: string, filePath: string): PublicSource[] {
  const parsed = JSON.parse(body) as PublicSourcesFile;
  if (!Array.isArray(parsed.sources)) {
    throw new Error(`${filePath}: sources must be an array.`);
  }
  return parsed.sources.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.trim().length === 0) {
      throw new Error(`${filePath}.sources[${index}].id must be a non-empty string.`);
    }
    return {
      id: item.id,
      slug: typeof item.slug === "string" ? item.slug : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
    };
  });
}

function loadCandidates(body: string, filePath: string): AcquisitionCandidate[] {
  const parsed = JSON.parse(body) as CandidateFile;
  if (parsed.version !== 1) {
    throw new Error(`${filePath}: version must be 1.`);
  }
  if (!Array.isArray(parsed.candidates)) {
    throw new Error(`${filePath}: candidates must be an array.`);
  }
  return parsed.candidates.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`${filePath}.candidates[${index}] must be an object.`);
    }
    return {
      sourceId: typeof item.sourceId === "string" ? item.sourceId : "",
      url: typeof item.url === "string" ? item.url : "",
      title: typeof item.title === "string" ? item.title : undefined,
      kind: typeof item.kind === "string" ? item.kind : undefined,
      discoveredAt: typeof item.discoveredAt === "string" ? item.discoveredAt : undefined,
      fixtureName: typeof item.fixtureName === "string" ? item.fixtureName : undefined,
      notes: typeof item.notes === "string" ? item.notes : undefined,
    };
  });
}

function validateSources(sources: PublicSource[], timestamp: string): AcquisitionDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: AcquisitionDiagnostic[] = [];
  sources.forEach((source, index) => {
    if (!isKebabId(source.id)) {
      diagnostics.push(diagnostic(source.id || "unknown", "validate", "invalid_source", timestamp, false, {
        path: `sources[${index}].id`,
        error: { code: "invalid_source_id", message: "Source id must be lowercase kebab-case." },
      }));
    }
    if (seen.has(source.id)) {
      diagnostics.push(diagnostic(source.id, "validate", "invalid_source", timestamp, false, {
        path: `sources[${index}].id`,
        error: { code: "duplicate_source", message: `Duplicate source id ${source.id}.` },
      }));
    }
    seen.add(source.id);
  });
  return diagnostics;
}

function validateCandidates(candidates: AcquisitionCandidate[], sources: PublicSource[], timestamp: string): AcquisitionDiagnostic[] {
  const sourceIds = new Set(sources.map((source) => source.id));
  const seen = new Set<string>();
  const diagnostics: AcquisitionDiagnostic[] = [];

  candidates.forEach((candidate, index) => {
    if (!sourceIds.has(candidate.sourceId)) {
      diagnostics.push(diagnostic(candidate.sourceId || "unknown", "candidate", "invalid_candidate", timestamp, false, {
        path: `candidates[${index}].sourceId`,
        error: { code: "unknown_source", message: `Candidate sourceId ${candidate.sourceId} is not registered.` },
      }));
    } else if (seen.has(candidate.sourceId)) {
      diagnostics.push(diagnostic(candidate.sourceId, "candidate", "invalid_candidate", timestamp, false, {
        path: `candidates[${index}].sourceId`,
        error: { code: "duplicate_candidate", message: `Duplicate candidate for sourceId ${candidate.sourceId}.` },
      }));
    }
    seen.add(candidate.sourceId);

    try {
      const parsed = new URL(candidate.url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Candidate URL must use http or https.");
      }
    } catch (error) {
      diagnostics.push(diagnostic(candidate.sourceId || "unknown", "candidate", "invalid_candidate", timestamp, false, {
        path: `candidates[${index}].url`,
        error: { code: "invalid_candidate_url", message: sanitizeError(error) },
      }));
    }

    if (candidate.fixtureName !== undefined) {
      try {
        validateFixtureName(candidate.fixtureName);
      } catch (error) {
        diagnostics.push(diagnostic(candidate.sourceId || "unknown", "candidate", "invalid_candidate", timestamp, false, {
          path: `candidates[${index}].fixtureName`,
          error: { code: "invalid_fixture_name", message: sanitizeError(error) },
        }));
      }
    }
  });

  return diagnostics;
}

async function fetchCandidate(url: string, timeoutMs: number, maxBytes: number): Promise<{ body: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok) {
      throw new AcquisitionFetchError("http_error", "http_error", `HTTP ${response.status} while fetching ${redactUrl(url)}.`);
    }
    if (!ACCEPTED_CONTENT_TYPES.some((accepted) => contentType.includes(accepted))) {
      throw new AcquisitionFetchError("unsupported_content", "unsupported_content", `Unsupported content type: ${contentType || "missing"}.`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (!reader) {
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        throw new Error(`Candidate exceeds ${maxBytes} byte limit.`);
      }
      return { body, contentType };
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Candidate exceeds ${maxBytes} byte limit.`);
      }
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks).toString("utf8"), contentType };
  } catch (error) {
    if (isAbortError(error)) {
      throw new AcquisitionFetchError("timeout", "timeout", `Fetch timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function fixturePathFor(source: PublicSource, candidate: AcquisitionCandidate, inputKind: IngestionInputKind): string {
  const extension = inputKind === "html" ? ".html" : ".txt";
  const fixtureName = candidate.fixtureName ?? `${source.slug && isKebabId(source.slug) ? source.slug : source.id}-m004-live${extension}`;
  validateFixtureName(fixtureName);
  return `${ACQUISITION_FIXTURE_PREFIX}/${fixtureName}`;
}

function targetFor(source: PublicSource, candidate: AcquisitionCandidate, fixturePath: string, inputKind: IngestionInputKind): IngestionTarget {
  const stem = path.posix.basename(fixturePath).replace(/\.[^.]+$/, "");
  return {
    id: `fixture-${stem}`,
    sourceId: source.id,
    artifactId: `art-${stem}`,
    title: candidate.title ?? source.name ?? source.id,
    inputKind,
    fixturePath,
    canonicalUrl: redactUrl(candidate.url),
    sampleFixture: false,
    mode: "fixture",
    notes: candidate.notes ?? `Captured from ${redactUrl(candidate.url)} for M004/S01 live acquisition.`,
  };
}

function validateCapturedTargets(targets: IngestionTarget[], diagnostics: AcquisitionDiagnostic[], timestamp: string): AcquisitionDiagnostic[] {
  const capturedBySource = new Map(diagnostics.filter((item) => item.status === "captured").map((item) => [item.sourceId, item.capturedArtifactPath]));
  const issues: AcquisitionDiagnostic[] = [];
  targets.forEach((target, index) => {
    const capturedPath = capturedBySource.get(target.sourceId);
    if (!capturedPath || capturedPath !== target.fixturePath) {
      issues.push(diagnostic(target.sourceId, "manifest", "invalid_candidate", timestamp, false, {
        path: `targets[${index}].fixturePath`,
        error: { code: "fixture_manifest_mismatch", message: "Captured artifact path must match generated manifest fixturePath." },
      }));
    }
  });
  return issues;
}

async function writeLatest(
  options: AcquireSourcesOptions,
  generatedAt: string,
  sourceCount: number,
  candidateCount: number,
  diagnostics: AcquisitionDiagnostic[],
  manifest: IngestionManifest | undefined,
): Promise<string> {
  const report: AcquisitionLatestReport = {
    version: 1,
    generatedAt,
    sourcesPath: options.sourcesPath,
    candidatesPath: options.candidatesPath,
    manifestPath: options.manifestPath,
    counts: {
      sources: sourceCount,
      candidates: candidateCount,
      captured: diagnostics.filter((item) => item.status === "captured").length,
      manifestTargets: manifest?.targets.length ?? 0,
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((item) => item.status === "invalid_candidate" || item.status === "invalid_source").length,
    },
    diagnostics,
  };
  const reportPath = path.join(options.acquisitionDir, "latest.json");
  await writeJson(reportPath, report);
  return reportPath;
}

function diagnostic(
  sourceId: string,
  phase: AcquisitionDiagnostic["phase"],
  status: AcquisitionStatus,
  timestamp: string,
  manifestIncluded: boolean,
  extra: Partial<Omit<AcquisitionDiagnostic, "sourceId" | "phase" | "status" | "timestamp" | "manifestIncluded">> = {},
): AcquisitionDiagnostic {
  return { sourceId, phase, status, timestamp, manifestIncluded, ...extra };
}

async function readBoundedFile(filePath: string, maxBytes: number): Promise<string> {
  const buffer = await readFile(filePath);
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Input exceeds ${maxBytes} byte limit: ${filePath}`);
  }
  return buffer.toString("utf8");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inferInputKind(contentType: string, url: string): IngestionInputKind {
  if (contentType.includes("html") || /\.html?(?:$|[?#])/i.test(url)) {
    return "html";
  }
  return "text";
}

function validateFixtureName(value: string): void {
  const normalized = value.replace(/\\/g, "/");
  if (normalized.includes("/") || normalized.includes("..") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Fixture name would cause path traversal or escape fixture root: ${value}`);
  }
  if (!/^[a-z0-9][a-z0-9.-]*\.(html|txt)$/i.test(normalized)) {
    throw new Error(`Fixture name must end in .html or .txt and contain only safe filename characters: ${value}`);
  }
}

function classifyFetchError(error: unknown): { status: AcquisitionStatus; code: string } {
  if (error instanceof AcquisitionFetchError) {
    return { status: error.status, code: error.code };
  }
  return { status: "http_error", code: "fetch_failed" };
}

class AcquisitionFetchError extends Error {
  constructor(public readonly status: AcquisitionStatus, public readonly code: string, message: string) {
    super(message);
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactUrl(message).replace(/[A-Za-z0-9._%+-]+=[^\s&]+/g, (match) => `${match.split("=")[0]}=<redacted>`);
}

function redactUrl(value: string): string {
  return value.replace(/([?&][^=&#\s]+)=([^&#\s]+)/g, "$1=<redacted>");
}

function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKebabId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
