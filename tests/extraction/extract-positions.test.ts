import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runExtraction, validatePersistedExtraction } from "../../lib/extraction/run";
import { createOpenAiProvider, ExtractionProviderError, parseProviderJson, type ExtractionProvider } from "../../lib/extraction/provider";

const fixedNow = () => new Date("2026-05-15T12:00:00.000Z");

test("fixture extraction writes validated draft, run, and validation diagnostics", async () => {
  const outDir = await tempOutDir();
  const result = await runExtraction({ outDir, provider: "fixture", raceSlug: "mayor", now: fixedNow });

  assert.equal(result.run.status, "complete");
  assert.equal(result.validation.ok, true);
  assert.equal(result.draft.positions.length, 2);
  assert.equal(result.draft.evidence.length, 2);
  assert.equal(result.draft.positions.every((position) => position.reviewStatus === "generated" && position.publicationStatus === "hidden"), true);
  assert.equal(result.run.provider.provider, "fixture");
  assert.equal(result.run.promptVersion, "position-extraction-v1");

  const persistedDraft = JSON.parse(await fs.readFile(path.join(outDir, "drafts", "latest.json"), "utf8"));
  const persistedRun = JSON.parse(await fs.readFile(path.join(outDir, "runs", "latest.json"), "utf8"));
  const persistedValidation = JSON.parse(await fs.readFile(path.join(outDir, "validation", "latest.json"), "utf8"));
  assert.equal(persistedDraft.runId, "run-20260515120000");
  assert.equal(persistedRun.counts.positions, 2);
  assert.equal(persistedValidation.ok, true);
});

test("dry run and prompt preview do not call providers but persist diagnostics", async () => {
  const outDir = await tempOutDir();
  const explodingProvider: ExtractionProvider = { name: "test", async complete() { throw new Error("should not be called"); } };

  const result = await runExtraction({ outDir, provider: "fixture", providerImpl: explodingProvider, dryRun: true, promptPreview: true, now: fixedNow });

  assert.equal(result.run.status, "complete");
  assert.equal(result.draft.positions.length, 0);
  assert.ok(result.run.promptPreviews?.[0]?.prompt.includes("Clean chunks (raw HTML omitted):"));
  assert.equal(result.run.phases.every((phase) => phase.status === "dry-run"), true);
});

test("malformed provider JSON is converted to sanitized failed run diagnostics", async () => {
  const outDir = await tempOutDir();
  const provider: ExtractionProvider = { name: "bad-json", async complete() { return parseProviderJson("not json"); } };

  const result = await runExtraction({ outDir, provider: "fixture", providerImpl: provider, now: fixedNow });

  assert.equal(result.run.status, "failed");
  assertIssue(result.run.issues, "invalid_provider_json");
  assert.equal(JSON.stringify(result.run).includes("sk-"), false);
});

test("missing OpenAI credentials fail closed without exposing secrets", async () => {
  const outDir = await tempOutDir();
  const provider = createOpenAiProvider({ model: "gpt-test", apiKey: "" });

  const result = await runExtraction({ outDir, provider: "openai", model: "gpt-test", providerImpl: provider, now: fixedNow });

  assert.equal(result.run.status, "failed");
  assertIssue(result.run.issues, "missing_credentials");
  assert.equal(JSON.stringify(result.run).includes("OPENAI_API_KEY"), true);
  assert.equal(JSON.stringify(result.run).includes("sk-"), false);
});

test("provider HTTP errors and aborts are normalized", async () => {
  const httpProvider = createOpenAiProvider({
    model: "gpt-test",
    apiKey: "sk-test-secret",
    fetchImpl: async () => new Response("nope", { status: 429, headers: { "x-request-id": "req-test" } }),
  });
  await assert.rejects(() => httpProvider.complete({ prompt: "{}", metadata: { provider: "openai", model: "gpt-test" } }), (error) => error instanceof ExtractionProviderError && error.code === "provider_http_429" && !error.message.includes("sk-test-secret"));

  const abortProvider = createOpenAiProvider({
    model: "gpt-test",
    apiKey: "sk-test-secret",
    timeoutMs: 1,
    fetchImpl: async (_url, init) => {
      await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      return new Response("{}", { status: 200 });
    },
  });
  await assert.rejects(() => abortProvider.complete({ prompt: "{}", metadata: { provider: "openai", model: "gpt-test" } }), (error) => error instanceof ExtractionProviderError && error.code === "provider_timeout");
});

test("hallucinated entity and missing chunk references are validation failures", async () => {
  const outDir = await tempOutDir();
  const provider: ExtractionProvider = {
    name: "hallucinating",
    async complete() {
      return { positions: [{ entityId: "ent-made-up", kind: "endorse", label: "Bad", evidence: [{ chunkId: "missing-chunk", kind: "quote", quote: "not in any chunk" }] }] };
    },
  };

  const result = await runExtraction({ outDir, provider: "fixture", providerImpl: provider, raceSlug: "mayor", now: fixedNow });

  assert.equal(result.run.status, "failed");
  assertIssue(result.validation.issues, "unknown_entity_id");
  assertIssue(result.validation.issues, "unknown_chunk_id");
});

test("missing ingestion files identify exact paths", async () => {
  const outDir = await tempOutDir();
  const manifestPath = path.join(outDir, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify({ version: 1, description: "missing files", targets: [{ id: "fixture-missing", sourceId: "src-growsf", artifactId: "art-does-not-exist", title: "Missing", inputKind: "html", fixturePath: "missing.html", canonicalUrl: "https://example.test/missing", sampleFixture: true }] }, null, 2));

  const result = await runExtraction({ outDir, manifestPath, provider: "fixture", raceSlug: "mayor", now: fixedNow });

  assert.equal(result.run.status, "failed");
  assertIssue(result.run.issues, "missing_input_file");
  assert.ok(result.run.issues.some((issue) => issue.message.includes("data/ingested/artifacts/src-does-not-exist.json")));
});

test("oversized chunks are rejected before provider calls", async () => {
  const outDir = await tempOutDir();
  const explodingProvider: ExtractionProvider = { name: "test", async complete() { throw new Error("provider should not be called for oversized chunks"); } };

  const result = await runExtraction({ outDir, provider: "fixture", providerImpl: explodingProvider, raceSlug: "mayor", maxChunkChars: 10, now: fixedNow });

  assert.equal(result.run.status, "failed");
  assertIssue(result.run.issues, "oversized_chunk");
  assert.equal(result.run.phases.length, 0);
});

test("validatePersistedExtraction writes validation report for persisted drafts", async () => {
  const outDir = await tempOutDir();
  await runExtraction({ outDir, provider: "fixture", raceSlug: "mayor", now: fixedNow });

  const report = await validatePersistedExtraction({ draftPath: path.join(outDir, "drafts", "latest.json"), validationPath: path.join(outDir, "validation", "latest.json"), raceSlug: "mayor" });

  assert.equal(report.ok, true);
  assert.equal(report.counts.positions, 2);
});

test("CLI help documents live extraction flags", () => {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/extract-positions.ts", "--help"], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /--provider <name>/);
  assert.match(result.stdout, /OPENAI_API_KEY/);
});

async function tempOutDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "votes-extraction-"));
}

function assertIssue(issues: { code: string }[], code: string): void {
  assert.equal(issues.some((issue) => issue.code === code), true, `Expected issue ${code}; got ${JSON.stringify(issues, null, 2)}`);
}
