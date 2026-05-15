import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { runIngestion } from "../../lib/ingestion/run";
import type { IngestionManifest } from "../../lib/ingestion/types";

const DEFAULT_MANIFEST = "data/ingestion/manifest.json";

test("runIngestion writes stable raw artifacts chunks and run diagnostics", async () => {
  const outDir = await temporaryDirectory();
  const first = await runIngestion({
    manifestPath: DEFAULT_MANIFEST,
    outDir,
    now: fixedClock(),
  });

  assert.equal(first.ok, true);
  assert.equal(first.summary.status, "complete");
  assert.equal(first.summary.counts.targets, 1);
  assert.equal(first.summary.counts.artifacts, 1);
  assert.ok(first.summary.counts.chunks >= 1);
  assert.equal(first.summary.counts.errors, 0);

  const expectedFiles = [
    "raw/src-ca-secretary-of-state-2026-primary-certified-candidates.txt",
    "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json",
    "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json",
    "runs/latest.json",
  ];

  for (const relative of expectedFiles) {
    assert.equal(existsSync(path.join(outDir, relative)), true, relative);
  }

  const artifact = JSON.parse(await readFile(path.join(outDir, "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json"), "utf8"));
  assert.equal(artifact.sourceId, "src-ca-secretary-of-state");
  assert.equal(artifact.id, "art-ca-secretary-of-state-2026-primary-certified-candidates");
  assert.equal(artifact.status, "chunked");
  assert.match(artifact.text, /Certified List of Candidates/i);
  assert.doesNotMatch(artifact.text, /mayor-sample|fixture-sf-chronicle-mayor-sample|fixture-growsf-mayor-sample/i);

  const chunks = JSON.parse(await readFile(path.join(outDir, "chunks/src-ca-secretary-of-state-2026-primary-certified-candidates.json"), "utf8"));
  assert.ok(Array.isArray(chunks));
  assert.equal(chunks.every((chunk: { sourceId: string }) => chunk.sourceId === "src-ca-secretary-of-state"), true);

  const rawBefore = await readFile(path.join(outDir, "raw/src-ca-secretary-of-state-2026-primary-certified-candidates.txt"), "utf8");
  const second = await runIngestion({
    manifestPath: DEFAULT_MANIFEST,
    outDir,
    now: fixedClock(),
  });
  const rawAfter = await readFile(path.join(outDir, "raw/src-ca-secretary-of-state-2026-primary-certified-candidates.txt"), "utf8");

  assert.equal(second.ok, true);
  assert.equal(first.runPath, second.runPath);
  assert.equal(rawBefore, rawAfter);
});

test("CLI supports --only-source and writes non-secret summary output", async () => {
  const outDir = await temporaryDirectory();
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/ingest-sources.ts", "--manifest", DEFAULT_MANIFEST, "--out", outDir, "--only-source", "src-ca-secretary-of-state"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /src-ca-secretary-of-state/);
  assert.doesNotMatch(result.stdout, /mayor-sample/);
  assert.equal(existsSync(path.join(outDir, "artifacts/src-ca-secretary-of-state-2026-primary-certified-candidates.json")), true);
  assert.equal(existsSync(path.join(outDir, "artifacts/src-sf-chronicle-mayor-sample.json")), false);
});

test("missing fixture is recorded as failed target and exits without usable artifacts", async () => {
  const outDir = await temporaryDirectory();
  const manifestPath = await writeManifest({
    version: 1,
    description: "Missing fixture test.",
    targets: [target({ fixturePath: "missing-fixture.html" })],
  });

  const result = await runIngestion({ manifestPath, outDir, now: fixedClock() });
  assert.equal(result.ok, false);
  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.counts.artifacts, 0);
  assert.equal(result.summary.targets[0]?.fetchStatus, "failed");
  assert.equal(result.summary.targets[0]?.importStatus, "failed");
  assert.match(result.summary.issues[0]?.message ?? "", /ENOENT|no such file/i);
});

test("invalid manifest shape fails before ingestion", async () => {
  const outDir = await temporaryDirectory();
  const manifestPath = path.join(await temporaryDirectory(), "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ version: 2, targets: "not-an-array" }), "utf8");

  const result = await runIngestion({ manifestPath, outDir, now: fixedClock() });
  assert.equal(result.ok, false);
  assert.equal(result.summary.targets.length, 0);
  assert.equal(result.summary.issues.some((issue) => issue.code === "invalid_manifest_version"), true);
  assert.equal(result.summary.issues.some((issue) => issue.code === "invalid_manifest_targets"), true);
});

test("--only-source with no matches records a diagnostic and returns non-zero CLI status", async () => {
  const outDir = await temporaryDirectory();
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/ingest-sources.ts", "--manifest", DEFAULT_MANIFEST, "--out", outDir, "--only-source", "src-nope"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no_matching_targets/);
  const run = JSON.parse(await readFile(path.join(outDir, "runs/latest.json"), "utf8"));
  assert.equal(run.issues[0]?.code, "no_matching_targets");
});

test("manifest path traversal and output-escaping IDs are rejected", async () => {
  const outDir = await temporaryDirectory();
  const manifestPath = await writeManifest({
    version: 1,
    description: "Traversal test.",
    targets: [target({ id: "bad-target", sourceId: "src-bad", artifactId: "art-bad", fixturePath: "../secret.html" })],
  });

  const result = await runIngestion({ manifestPath, outDir, now: fixedClock() });
  assert.equal(result.ok, false);
  assert.equal(result.summary.targets.length, 0);
  assert.equal(result.summary.issues.some((issue) => issue.code === "invalid_fixture_path"), true);
});

test("URL fetch failures are recorded when network mode is enabled", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(503, { "content-type": "text/html" });
    response.end("temporarily unavailable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.notEqual(typeof address, "string");
    const port = (address as AddressInfo).port;
    const manifestPath = await writeManifest({
      version: 1,
      description: "Fetch failure test.",
      targets: [target({ mode: "url", canonicalUrl: `http://127.0.0.1:${port}/source` })],
    });
    const outDir = await temporaryDirectory();

    const result = await runIngestion({ manifestPath, outDir, allowNetwork: true, now: fixedClock() });
    assert.equal(result.ok, false);
    assert.equal(result.summary.targets[0]?.fetchStatus, "failed");
    assert.equal(result.summary.issues.some((issue) => /HTTP 503/.test(issue.message)), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

async function temporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "votes-ingestion-"));
}

async function writeManifest(manifest: IngestionManifest): Promise<string> {
  const directory = await temporaryDirectory();
  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function fixedClock(): () => Date {
  return () => new Date("2026-01-02T03:04:05.000Z");
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
