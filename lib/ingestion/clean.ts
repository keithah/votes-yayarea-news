import type { CleanTextResult, IngestionInputKind, IngestionValidationIssue } from "./types";

export interface CleanReadableTextOptions {
  inputKind?: IngestionInputKind;
  path?: string;
  minTextLength?: number;
}

const DEFAULT_MIN_TEXT_LENGTH = 80;

const BLOCK_TAGS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
];

const COMMON_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "©",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

export function cleanReadableText(input: string, options: CleanReadableTextOptions = {}): CleanTextResult {
  const inputKind = options.inputKind ?? inferInputKind(input);
  const path = options.path ?? "input";
  const minTextLength = options.minTextLength ?? DEFAULT_MIN_TEXT_LENGTH;
  const originalLength = input.length;
  let working = input.replace(/\u0000/g, "");

  const scriptMatches = countMatches(working, /<script\b[\s\S]*?<\/script\s*>/gi);
  working = working.replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ");

  const styleMatches = countMatches(working, /<style\b[\s\S]*?<\/style\s*>/gi);
  working = working.replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ");

  const boilerplateMatches = countMatches(
    working,
    /<(nav|footer|header|aside)\b[\s\S]*?<\/\1\s*>/gi,
  );
  working = working.replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const headingCount = countMatches(working, /<h[1-6]\b[^>]*>/gi);

  if (inputKind === "html") {
    working = working.replace(/<!--[\s\S]*?-->/g, " ");
    working = working.replace(new RegExp(`</?(${BLOCK_TAGS.join("|")})\\b[^>]*>`, "gi"), "\n");
    working = working.replace(/<[^>]+>/g, " ");
  }

  const text = normalizeWhitespace(decodeHtmlEntities(working));
  const issues: IngestionValidationIssue[] = [];
  const lowText = text.length < minTextLength;

  if (text.length === 0) {
    issues.push({
      code: "empty_text",
      severity: "error",
      path,
      message: "Input did not contain readable text after cleaning.",
    });
  } else if (lowText) {
    issues.push({
      code: "low_text",
      severity: "warning",
      path,
      message: `Cleaned text is shorter than ${minTextLength} characters.`,
    });
  }

  return {
    text,
    metadata: {
      inputKind,
      originalLength,
      normalizedLength: text.length,
      removedScriptLikeBlocks: scriptMatches,
      removedStyleLikeBlocks: styleMatches,
      removedBoilerplateBlocks: boilerplateMatches,
      headingCount,
      lowText,
    },
    issues,
  };
}

function inferInputKind(input: string): IngestionInputKind {
  return /<\s*(?:!doctype|html|body|article|main|section|p|h[1-6]|div|script|style)\b/i.test(input)
    ? "html"
    : "text";
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const codePoint = Number.parseInt(body.slice(2), 16);
      return safeCodePoint(entity, codePoint);
    }

    if (body.startsWith("#")) {
      const codePoint = Number.parseInt(body.slice(1), 10);
      return safeCodePoint(entity, codePoint);
    }

    return COMMON_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function safeCodePoint(fallback: string, codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return fallback;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
