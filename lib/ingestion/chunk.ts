import path from "node:path";
import type { ArtifactChunk, ChunkTextOptions, IngestionValidationIssue } from "./types";

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_MIN_CHARS = 240;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ChunkArtifactInput {
  sourceId: string;
  artifactId: string;
  text: string;
  maxChars?: number;
  minChars?: number;
}

export function chunkArtifactText(input: ChunkArtifactInput): ArtifactChunk[] {
  assertKebabCaseId(input.sourceId, "sourceId");
  assertKebabCaseId(input.artifactId, "artifactId");

  const text = input.text.trim();
  if (!text) {
    return [];
  }

  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  const minChars = input.minChars ?? Math.min(DEFAULT_MIN_CHARS, maxChars);
  validateChunkOptions({ maxChars, minChars });

  const spans = splitIntoSpans(text, maxChars, minChars);
  return spans.map((span, index) => {
    const order = index + 1;
    return {
      id: `${input.artifactId}-chunk-${String(order).padStart(3, "0")}`,
      sourceId: input.sourceId,
      artifactId: input.artifactId,
      order,
      text: span.text,
      startOffset: span.startOffset,
      endOffset: span.endOffset,
      charCount: span.text.length,
    };
  });
}

export function validateKebabCaseId(value: string, path: string): IngestionValidationIssue[] {
  if (ID_PATTERN.test(value)) {
    return [];
  }

  return [
    {
      code: "invalid_id",
      severity: "error",
      path,
      message: "Expected a lowercase kebab-case identifier.",
    },
  ];
}

export function normalizeFixturePath(fixturePath: string, baseDirectory = "data/ingestion/fixtures"): string {
  const normalized = fixturePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`Fixture path must be relative: ${fixturePath}`);
  }

  const joined = path.posix.normalize(path.posix.join(baseDirectory, normalized));
  const safeBase = baseDirectory.replace(/\\/g, "/").replace(/\/$/, "") || ".";

  if (safeBase === ".") {
    if (joined === ".." || joined.startsWith("../")) {
      throw new Error(`Fixture path escapes ${safeBase}: ${fixturePath}`);
    }
    return joined;
  }

  if (joined !== safeBase && !joined.startsWith(`${safeBase}/`)) {
    throw new Error(`Fixture path escapes ${safeBase}: ${fixturePath}`);
  }

  return joined;
}

function assertKebabCaseId(value: string, label: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`${label} must be lowercase kebab-case: ${value}`);
  }
}

function validateChunkOptions(options: Required<ChunkTextOptions>): void {
  if (!Number.isInteger(options.maxChars) || options.maxChars < 1) {
    throw new Error("maxChars must be a positive integer.");
  }

  if (!Number.isInteger(options.minChars) || options.minChars < 1) {
    throw new Error("minChars must be a positive integer.");
  }

  if (options.minChars > options.maxChars) {
    throw new Error("minChars must be less than or equal to maxChars.");
  }
}

interface ChunkSpan {
  text: string;
  startOffset: number;
  endOffset: number;
}

function splitIntoSpans(text: string, maxChars: number, minChars: number): ChunkSpan[] {
  const spans: ChunkSpan[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) {
      cursor += 1;
    }

    if (cursor >= text.length) {
      break;
    }

    const remaining = text.length - cursor;
    if (remaining <= maxChars) {
      appendSpan(spans, text, cursor, text.length);
      break;
    }

    const desiredEnd = cursor + maxChars;
    let end = findBoundary(text, cursor, desiredEnd, minChars);

    if (end <= cursor) {
      end = desiredEnd;
    }

    appendSpan(spans, text, cursor, end);
    cursor = end;
  }

  return spans;
}

function findBoundary(text: string, start: number, desiredEnd: number, minChars: number): number {
  const minEnd = start + minChars;
  const searchStart = Math.min(desiredEnd, text.length);
  const boundaryPattern = /[.!?]\s|\n{1,2}|;\s|,\s|\s/g;
  let candidate = -1;
  let match: RegExpExecArray | null;
  boundaryPattern.lastIndex = start;

  while ((match = boundaryPattern.exec(text)) !== null) {
    const boundaryEnd = match.index + match[0].length;
    if (boundaryEnd > desiredEnd) {
      break;
    }
    if (boundaryEnd >= minEnd && boundaryEnd <= searchStart) {
      candidate = boundaryEnd;
    }
  }

  return candidate;
}

function appendSpan(spans: ChunkSpan[], text: string, startOffset: number, endOffset: number): void {
  const trimmedStart = trimStartOffset(text, startOffset, endOffset);
  const trimmedEnd = trimEndOffset(text, trimmedStart, endOffset);
  if (trimmedEnd <= trimmedStart) {
    return;
  }

  spans.push({
    text: text.slice(trimmedStart, trimmedEnd),
    startOffset: trimmedStart,
    endOffset: trimmedEnd,
  });
}

function trimStartOffset(text: string, start: number, end: number): number {
  let next = start;
  while (next < end && /\s/.test(text[next] ?? "")) {
    next += 1;
  }
  return next;
}

function trimEndOffset(text: string, start: number, end: number): number {
  let next = end;
  while (next > start && /\s/.test(text[next - 1] ?? "")) {
    next -= 1;
  }
  return next;
}
