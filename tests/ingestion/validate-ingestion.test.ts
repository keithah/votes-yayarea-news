import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runIngestion } from "../../lib/ingestion/run";
import { validateIngestion } from "../../lib/ingestion/validate";
import type { ArtifactChunk, IngestedArtifact, IngestionManifest, IngestionRunSummary } from "../../lib/ingestion/types";

const DEFAULT_MANIFEST = "data/ingestion/manifest.json";
const DEFAULT_PUBLIC_SOURCES = "data/public/sources.json";

test("validateIngestion accepts representative generated fixtures", async () => {
  const outDir = await generatedOutDir();
  const result = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assert.equal(result.ok, true);
  assert.equal(result.counts.targets, 1);
  assert.equal(result.counts.artifacts, 1);
  assert.ok(result.counts.chunks >= 1);
  assert.equal(result.counts.errors, 0);
  assert.equal(result.checkedFiles.some((file) => file.endsWith("runs/latest.json")), true);
});

test("CLI writes path-qualified validation report", async () => {
  const outDir = await generatedOutDir();
  const reportPath = path.join(outDir, "validation/latest.json");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/validate-ingestion.ts", "--manifest", DEFAULT_MANIFEST, "--out", outDir, "--report", reportPath],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"status": "pass"/);
  assert.equal(existsSync(reportPath), true);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.ok, true);
  assert.equal(Array.isArray(report.checkedFiles), true);
});

test("missing raw capture is a path-qualified validation issue", async () => {
  const outDir = await generatedOutDir();
  await rm(path.join(outDir, "raw/src-ca-secretary-of-state-2026-primary-certified-candidates.txt"));

  const result = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assertIssue(result, "missing_raw_capture", "raw/src-ca-secretary-of-state-2026-primary-certified-candidates.txt");
});

test("missing artifact file and stale manifest target are validation issues", async () => {
  const outDir = await generatedOutDir();
  await rm(path.join(outDir, "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json"));
  const manifestPath = await writeManifest({
    version: 1,
    description: "stale target test",
    targets: [target({ sourceId: "src-ca-secretary-of-state", artifactId: "art-ca-secretary-of-state-2026-primary-certified-candidates" }), target({ id: "fixture-stale", sourceId: "src-ca-secretary-of-state", artifactId: "art-stale" })],
  });

  const result = await validateIngestion({ manifestPath, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assertIssue(result, "missing_generated_file", "artifacts/src-stale.json");
  assertIssue(result, "missing_generated_file", "chunks/src-stale.json");
});

test("chunk referencing a missing artifact is rejected", async () => {
  const outDir = await generatedOutDir();
  const chunkPath = path.join(outDir, "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json");
  const chunks = (await readJson<ArtifactChunk[]>(chunkPath)).map((chunk) => ({ ...chunk, artifactId: "art-missing" }));
  await writeJson(chunkPath, chunks);

  const result = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assertIssue(result, "chunk_artifact_mismatch", "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json[0].artifactId");
});

test("duplicate chunk id and order are rejected", async () => {
  const outDir = await generatedOutDir();
  const chunkPath = path.join(outDir, "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json");
  const chunks = await readJson<ArtifactChunk[]>(chunkPath);
  chunks.push({ ...chunks[0] });
  await writeJson(chunkPath, chunks);

  const result = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assertIssue(result, "duplicate_chunk_id", "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json[2].id");
  assertIssue(result, "duplicate_chunk_order", "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json[2].order");
});

test("empty and low clean text are rejected", async () => {
  const outDir = await generatedOutDir();
  const artifactPath = path.join(outDir, "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json");
  const artifact = await readJson<IngestedArtifact>(artifactPath);
  await writeJson(artifactPath, { ...artifact, text: "   ", metadata: { ...artifact.metadata, lowText: true } });

  const result = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assertIssue(result, "empty_clean_text", "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json.text");
  assertIssue(result, "low_clean_text", "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json.metadata.lowText");
});

test("unknown sourceId is rejected from manifest and artifact", async () => {
  const outDir = await generatedOutDir();
  const manifestPath = await writeManifest({
    version: 1,
    description: "unknown source test",
    targets: [target({ sourceId: "src-unknown", artifactId: "art-ca-secretary-of-state-2026-primary-certified-candidates" })],
  });
  const artifactPath = path.join(outDir, "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json");
  const artifact = await readJson<IngestedArtifact>(artifactPath);
  await writeJson(artifactPath, { ...artifact, sourceId: "src-unknown" });

  const result = await validateIngestion({ manifestPath, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assertIssue(result, "unknown_source_id", ".sourceId");
});

test("malformed JSON in generated files is reported", async () => {
  const outDir = await generatedOutDir();
  await writeFile(path.join(outDir, "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json"), "{not-json", "utf8");

  const result = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });

  assertIssue(result, "chunk_json_malformed", "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json");
});

test("failed run diagnostics and malformed run summary are rejected", async () => {
  const outDir = await generatedOutDir();
  const runPath = path.join(outDir, "runs/latest.json");
  const run = await readJson<IngestionRunSummary>(runPath);
  await writeJson(runPath, {
    ...run,
    status: "failed",
    counts: { ...run.counts, errors: 1 },
    phases: [...run.phases, { phase: "fetch", status: "failed", sourceId: "src-ca-secretary-of-state", artifactId: "art-ca-secretary-of-state-2026-primary-certified-candidates", message: "boom" }],
    targets: [{ ...run.targets[0], importStatus: "failed" }, ...run.targets.slice(1)],
    issues: [{ code: "target_ingest_failed", severity: "error", path: "targets.fixture", message: "boom" }],
  });

  const result = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });
  assertIssue(result, "run_summary_failed", "runs/latest.json.status");
  assertIssue(result, "run_phase_failed", "runs/latest.json.phases");
  assertIssue(result, "run_target_failed", "runs/latest.json.targets[0]");
  assertIssue(result, "run_issue_error", "runs/latest.json.issues[0]");

  await writeFile(runPath, "{bad-run", "utf8");
  const malformed = await validateIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, publicSourcesPath: DEFAULT_PUBLIC_SOURCES });
  assertIssue(malformed, "run_summary_json_malformed", "runs/latest.json");
});

async function generatedOutDir(): Promise<string> {
  const outDir = await temporaryDirectory();
  const result = await runIngestion({ manifestPath: DEFAULT_MANIFEST, outDir, now: () => new Date("2026-01-02T03:04:05.000Z") });
  assert.equal(result.ok, true);
  return outDir;
}

async function temporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "votes-validate-ingestion-"));
}

async function writeManifest(manifest: IngestionManifest): Promise<string> {
  const directory = await temporaryDirectory();
  const manifestPath = path.join(directory, "manifest.json");
  await writeJson(manifestPath, manifest);
  return manifestPath;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function target(overrides: Partial<IngestionManifest["targets"][number]> = {}): IngestionManifest["targets"][number] {
  return {
    id: "fixture-ca-secretary-of-state-2026-primary-certified-candidates",
    sourceId: "src-ca-secretary-of-state",
    artifactId: "art-ca-secretary-of-state-2026-primary-certified-candidates",
    title: "California Secretary of State certified candidate list",
    inputKind: "text",
    fixturePath: "ca-secretary-of-state-2026-primary-certified-candidates.txt",
    canonicalUrl: "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf",
    sampleFixture: false,
    ...overrides,
  };
}

function assertIssue(result: { issues: Array<{ code: string; path: string }> }, code: string, pathIncludes: string): void {
  assert.equal(
    result.issues.some((issue) => issue.code === code && issue.path.includes(pathIncludes)),
    true,
    `Expected ${code} at path containing ${pathIncludes}; got ${JSON.stringify(result.issues, null, 2)}`,
  );
}
