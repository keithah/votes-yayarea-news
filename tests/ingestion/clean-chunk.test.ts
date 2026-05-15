import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanReadableText } from "../../lib/ingestion/clean";
import { chunkArtifactText, normalizeFixturePath, validateKebabCaseId } from "../../lib/ingestion/chunk";
import type { IngestionManifest } from "../../lib/ingestion/types";

const MANIFEST_PATH = "data/ingestion/manifest.json";

test("committed real-source fixtures clean into readable text and stable chunks", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.version, 1);
  assert.equal(manifest.targets.length, 1);

  for (const target of manifest.targets) {
    const fixturePath = normalizeFixturePath(target.fixturePath);
    const html = await readFile(fixturePath, "utf8");
    const cleaned = cleanReadableText(html, { inputKind: target.inputKind, path: fixturePath });

    assert.equal(cleaned.issues.some((issue) => issue.severity === "error"), false, target.id);
    assert.equal(cleaned.metadata.removedScriptLikeBlocks, 0, target.id);
    assert.equal(cleaned.metadata.removedStyleLikeBlocks, 0, target.id);
    assert.equal(cleaned.metadata.removedBoilerplateBlocks, 0, target.id);
    assert.match(cleaned.text, /Certified List of Candidates/i);
    assert.doesNotMatch(cleaned.text, /mayor-sample|fixture-sf-chronicle-mayor-sample|fixture-growsf-mayor-sample/i);

    const chunks = chunkArtifactText({
      sourceId: target.sourceId,
      artifactId: target.artifactId,
      text: cleaned.text,
      maxChars: 180,
      minChars: 80,
    });

    assert.ok(chunks.length >= 2, target.id);
    assert.deepEqual(
      chunks.map((chunk) => chunk.order),
      chunks.map((_, index) => index + 1),
      target.id,
    );
    assert.deepEqual(
      chunks.map((chunk) => chunk.id),
      chunks.map((_, index) => `${target.artifactId}-chunk-${String(index + 1).padStart(3, "0")}`),
      target.id,
    );
    assert.equal(chunks.every((chunk) => chunk.sourceId === target.sourceId), true);
    assert.equal(chunks.every((chunk) => chunk.artifactId === target.artifactId), true);
    assert.equal(chunks.every((chunk) => chunk.text.length > 0), true);
    assert.equal(chunks.every((chunk) => chunk.text.length <= 180), true);
  }
});

test("cleaner decodes entities, preserves headings, and collapses whitespace", () => {
  const cleaned = cleanReadableText(
    `<article><h1>Mayor &amp; housing</h1><p>Candidate&nbsp;A &mdash; supports homes.</p><p>Second   paragraph.</p></article>`,
    { inputKind: "html", minTextLength: 10 },
  );

  assert.equal(cleaned.text, "Mayor & housing\nCandidate A — supports homes.\nSecond paragraph.");
  assert.equal(cleaned.metadata.headingCount, 1);
  assert.deepEqual(cleaned.issues, []);
});

test("malformed html degrades to readable text", () => {
  const cleaned = cleanReadableText(
    "<main><h1>Broken sample<p>Readable body text remains even without closing tags &amp; still works.",
    { inputKind: "html", minTextLength: 20 },
  );

  assert.match(cleaned.text, /Broken sample/);
  assert.match(cleaned.text, /Readable body text remains/);
  assert.equal(cleaned.issues.some((issue) => issue.code === "empty_text"), false);
});

test("empty and boilerplate-only html produce validation failures", () => {
  const empty = cleanReadableText("   ", { inputKind: "html" });
  assert.equal(empty.text, "");
  assert.equal(empty.issues[0]?.code, "empty_text");
  assert.equal(empty.issues[0]?.severity, "error");

  const boilerplateOnly = cleanReadableText(
    "<html><style>body{}</style><script>run()</script><nav>Menu</nav><footer>Footer</footer></html>",
    { inputKind: "html" },
  );
  assert.equal(boilerplateOnly.text, "");
  assert.equal(boilerplateOnly.issues[0]?.code, "empty_text");
});

test("chunker splits oversized single paragraphs without empty chunks", () => {
  const text = "A".repeat(95) + " " + "B".repeat(95) + " " + "C".repeat(95);
  const chunks = chunkArtifactText({
    sourceId: "src-ca-secretary-of-state",
    artifactId: "art-ca-secretary-of-state-2026-primary-certified-candidates",
    text,
    maxChars: 100,
    minChars: 60,
  });

  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((chunk) => chunk.id), [
    "art-ca-secretary-of-state-2026-primary-certified-candidates-chunk-001",
    "art-ca-secretary-of-state-2026-primary-certified-candidates-chunk-002",
    "art-ca-secretary-of-state-2026-primary-certified-candidates-chunk-003",
  ]);
  assert.equal(chunks.every((chunk) => chunk.text.length > 0), true);
  assert.equal(chunks.every((chunk) => chunk.text.length <= 100), true);
  assert.equal(chunks[0]?.startOffset, 0);
  assert.ok((chunks[1]?.startOffset ?? 0) > (chunks[0]?.startOffset ?? 0));
});

test("invalid IDs are rejected before chunk creation", () => {
  assert.deepEqual(validateKebabCaseId("src-growsf", "targets[0].sourceId"), []);
  assert.equal(validateKebabCaseId("Src GrowSF", "targets[0].sourceId")[0]?.code, "invalid_id");

  assert.throws(
    () => chunkArtifactText({ sourceId: "Src GrowSF", artifactId: "art-good", text: "valid text" }),
    /sourceId must be lowercase kebab-case/,
  );
});

test("fixture path normalization rejects traversal and absolute paths", () => {
  assert.equal(
    normalizeFixturePath("ca-secretary-of-state-2026-primary-certified-candidates.txt"),
    "data/ingestion/fixtures/ca-secretary-of-state-2026-primary-certified-candidates.txt",
  );
  assert.throws(() => normalizeFixturePath("../public/sources.json"), /escapes/);
  assert.throws(() => normalizeFixturePath("/tmp/source.html"), /relative/);
});

async function readManifest(): Promise<IngestionManifest> {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as IngestionManifest;
}
