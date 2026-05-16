import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";

const ACQUIRE_MODULE = "../../lib/acquisition/acquire-sources";
const ACQUIRE_CLI = "scripts/acquire-sources.ts";

test("acquireSources emits exactly one diagnostic per registered source and captures successful HTML into a manifest target", async () => {
  const directory = await temporaryDirectory();
  const server = await createServer({
    "/guide": {
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: htmlGuide("Public voter guide", "This public guide contains durable recommendation text for the June 2026 election. ".repeat(8)),
    },
  });

  try {
    const sourcesPath = await writeSources(directory, [source("src-alpha"), source("src-beta")]);
    const candidatesPath = await writeCandidates(directory, [
      candidate("src-alpha", `${server.origin}/guide`, { title: "Alpha public guide" }),
    ]);
    const output = paths(directory);

    const result = await acquireSources({
      sourcesPath,
      candidatesPath,
      acquisitionDir: output.acquisitionDir,
      manifestPath: output.manifestPath,
      fetchTimeoutMs: 1_000,
      now: fixedClock(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.length, 2);
    assert.deepEqual(
      result.diagnostics.map((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId).sort(),
      ["src-alpha", "src-beta"],
    );

    const captured = result.diagnostics.find((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId === "src-alpha");
    assert.equal(captured?.phase, "capture");
    assert.equal(captured?.status, "captured");
    assert.equal(captured?.attemptedUrl, `${server.origin}/guide`);
    assert.equal(captured?.manifestIncluded, true);
    assert.equal(captured?.timestamp, "2026-01-02T03:04:05.000Z");
    assert.match(captured?.capturedArtifactPath ?? "", /^data\/acquisition\/fixtures\//);
    assert.doesNotMatch(captured?.capturedArtifactPath ?? "", /sample/i);

    const skipped = result.diagnostics.find((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId === "src-beta");
    assert.equal(skipped?.status, "skipped");
    assert.equal(skipped?.phase, "candidate");
    assert.equal(skipped?.manifestIncluded, false);
    assert.match(skipped?.skippedReason ?? "", /no candidate/i);

    const latest = JSON.parse(await readFile(path.join(output.acquisitionDir, "latest.json"), "utf8"));
    assert.equal(latest.diagnostics.length, 2);
    assert.equal(latest.diagnostics.every((diagnostic: AcquisitionDiagnostic) => diagnostic.timestamp), true);

    const manifest = JSON.parse(await readFile(output.manifestPath, "utf8"));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.targets.length, 1);
    assert.equal(manifest.targets[0].sourceId, "src-alpha");
    assert.equal(manifest.targets[0].sampleFixture, false);
    assert.equal(manifest.targets[0].mode, "fixture");
    assert.match(manifest.targets[0].fixturePath, /^data\/acquisition\/fixtures\//);
    assert.equal(existsSync(path.resolve(manifest.targets[0].fixturePath)), true);

    const capturedBody = await readFile(path.resolve(manifest.targets[0].fixturePath), "utf8");
    assert.match(capturedBody, /Public voter guide/);
  } finally {
    await server.close();
  }
});

test("HTTP failures unsupported content and low-text bodies are diagnostic-only and excluded from the manifest", async () => {
  const directory = await temporaryDirectory();
  const server = await createServer({
    "/unavailable": { status: 503, contentType: "text/html", body: "temporarily unavailable" },
    "/pdf": { status: 200, contentType: "application/pdf", body: "%PDF-1.7 not captured by HTML acquisition" },
    "/thin": { status: 200, contentType: "text/html", body: "<html><body>tiny</body></html>" },
  });

  try {
    const sourcesPath = await writeSources(directory, [source("src-503"), source("src-pdf"), source("src-thin")]);
    const candidatesPath = await writeCandidates(directory, [
      candidate("src-503", `${server.origin}/unavailable`),
      candidate("src-pdf", `${server.origin}/pdf`),
      candidate("src-thin", `${server.origin}/thin`),
    ]);
    const output = paths(directory);

    const result = await acquireSources({
      sourcesPath,
      candidatesPath,
      acquisitionDir: output.acquisitionDir,
      manifestPath: output.manifestPath,
      fetchTimeoutMs: 1_000,
      now: fixedClock(),
    });

    assert.equal(result.ok, true, "ordinary upstream/content misses should not make the whole acquisition process fail");
    assert.equal(result.diagnostics.length, 3);
    assert.equal(result.diagnostics.every((diagnostic: AcquisitionDiagnostic) => diagnostic.manifestIncluded === false), true);
    assert.equal(result.diagnostics.find((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId === "src-503")?.status, "http_error");
    assert.match(result.diagnostics.find((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId === "src-503")?.error?.message ?? "", /503/);
    assert.equal(result.diagnostics.find((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId === "src-pdf")?.status, "unsupported_content");
    assert.match(result.diagnostics.find((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId === "src-pdf")?.error?.message ?? "", /application\/pdf/);
    assert.equal(result.diagnostics.find((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId === "src-thin")?.status, "low_text");

    const manifest = JSON.parse(await readFile(output.manifestPath, "utf8"));
    assert.equal(manifest.targets.length, 0);
  } finally {
    await server.close();
  }
});

test("malformed candidate data fails closed with path-qualified diagnostics", async () => {
  const directory = await temporaryDirectory();
  const sourcesPath = await writeSources(directory, [source("src-alpha"), source("src-beta")]);
  const candidatesPath = await writeCandidates(directory, [
    candidate("src-alpha", "https://example.test/one"),
    candidate("src-alpha", "https://example.test/two"),
    candidate("src-unknown", "https://example.test/unknown"),
  ]);
  const output = paths(directory);

  const result = await acquireSources({
    sourcesPath,
    candidatesPath,
    acquisitionDir: output.acquisitionDir,
    manifestPath: output.manifestPath,
    fetchTimeoutMs: 1_000,
    now: fixedClock(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 2);
  assert.equal(result.diagnostics.every((diagnostic: AcquisitionDiagnostic) => diagnostic.phase === "candidate"), true);
  assert.equal(result.diagnostics.every((diagnostic: AcquisitionDiagnostic) => diagnostic.manifestIncluded === false), true);
  assert.ok(result.diagnostics.some((diagnostic: AcquisitionDiagnostic) => diagnostic.status === "invalid_candidate" && diagnostic.path === "candidates[1].sourceId"));
  assert.ok(result.diagnostics.some((diagnostic: AcquisitionDiagnostic) => diagnostic.status === "invalid_candidate" && diagnostic.path === "candidates[2].sourceId"));
  assert.equal(existsSync(output.manifestPath), false, "invalid candidates must fail before writing ingestion targets");
});

test("path traversal in generated fixture names is rejected before writing files", async () => {
  const directory = await temporaryDirectory();
  const server = await createServer({
    "/guide": {
      status: 200,
      contentType: "text/html",
      body: htmlGuide("Traversal guide", "Enough public text to otherwise qualify as a capture. ".repeat(10)),
    },
  });

  try {
    const sourcesPath = await writeSources(directory, [source("src-alpha")]);
    const candidatesPath = await writeCandidates(directory, [
      candidate("src-alpha", `${server.origin}/guide`, { fixtureName: "../escaped.html" }),
    ]);
    const output = paths(directory);

    const result = await acquireSources({
      sourcesPath,
      candidatesPath,
      acquisitionDir: output.acquisitionDir,
      manifestPath: output.manifestPath,
      fetchTimeoutMs: 1_000,
      now: fixedClock(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].sourceId, "src-alpha");
    assert.equal(result.diagnostics[0].status, "invalid_candidate");
    assert.equal(result.diagnostics[0].path, "candidates[0].fixtureName");
    assert.match(result.diagnostics[0].error?.message ?? "", /path traversal|escape/i);
    assert.equal(existsSync(path.join(output.acquisitionDir, "..", "escaped.html")), false);
    assert.equal(existsSync(output.manifestPath), false);
  } finally {
    await server.close();
  }
});

test("bounded acquisition remains deterministic with one diagnostic per source for larger registries", async () => {
  const directory = await temporaryDirectory();
  const sources = Array.from({ length: 10 }, (_value, index) => source(`src-${String(index + 1).padStart(2, "0")}`));
  const sourcesPath = await writeSources(directory, sources);
  const candidatesPath = await writeCandidates(directory, []);
  const output = paths(directory);

  const result = await acquireSources({
    sourcesPath,
    candidatesPath,
    acquisitionDir: output.acquisitionDir,
    manifestPath: output.manifestPath,
    fetchTimeoutMs: 1_000,
    maxSources: 10,
    maxCandidateBytes: 32_000,
    now: fixedClock(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.length, 10);
  assert.deepEqual(
    result.diagnostics.map((diagnostic: AcquisitionDiagnostic) => diagnostic.sourceId),
    sources.map((registeredSource) => registeredSource.id),
  );
  assert.equal(result.diagnostics.every((diagnostic: AcquisitionDiagnostic) => diagnostic.status === "skipped"), true);
});

test("candidate ledger can record searched sources with explicit no-public-artifact diagnostics", async () => {
  const directory = await temporaryDirectory();
  const sourcesPath = await writeSources(directory, [source("src-alpha")]);
  const candidatesPath = await writeCandidates(directory, [
    {
      sourceId: "src-alpha",
      kind: "no-public-2026-guide",
      discoveredAt: "2026-01-01T00:00:00.000Z",
      skippedReason: "no-public-2026-guide: searched official site and public web results; no source-owned 2026 guide or endorsement artifact located.",
      notes: "Search diagnostic only; do not ingest homepage.",
    },
  ]);
  const output = paths(directory);

  const result = await acquireSources({
    sourcesPath,
    candidatesPath,
    acquisitionDir: output.acquisitionDir,
    manifestPath: output.manifestPath,
    fetchTimeoutMs: 1_000,
    now: fixedClock(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].sourceId, "src-alpha");
  assert.equal(result.diagnostics[0].phase, "candidate");
  assert.equal(result.diagnostics[0].status, "skipped");
  assert.match(result.diagnostics[0].skippedReason ?? "", /no-public-2026-guide/);
  assert.equal(result.diagnostics[0].manifestIncluded, false);

  const manifest = JSON.parse(await readFile(output.manifestPath, "utf8"));
  assert.equal(manifest.targets.length, 0);
});

test("CLI writes diagnostics without printing secrets or raw page bodies", async () => {
  const directory = await temporaryDirectory();
  const secret = "SECRET_TOKEN_SHOULD_NOT_LEAK";
  const rawBodyMarker = "RAW_BODY_MARKER_SHOULD_NOT_PRINT";
  const server = await createServer({
    "/guide": {
      status: 200,
      contentType: "text/html",
      body: htmlGuide("Secret-bearing guide", `${rawBodyMarker} public text `.repeat(12)),
    },
  });

  try {
    const sourcesPath = await writeSources(directory, [source("src-alpha")]);
    const candidatesPath = await writeCandidates(directory, [
      candidate("src-alpha", `${server.origin}/guide?token=${secret}`),
    ]);
    const output = paths(directory);

    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      ACQUIRE_CLI,
      "--sources",
      sourcesPath,
      "--candidates",
      candidatesPath,
      "--out",
      output.acquisitionDir,
      "--manifest",
      output.manifestPath,
      "--fetch-timeout-ms",
      "1000",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    assert.match(result.stdout, /src-alpha/);
    assert.doesNotMatch(combinedOutput, new RegExp(secret));
    assert.doesNotMatch(combinedOutput, new RegExp(rawBodyMarker));

    const latest = JSON.parse(await readFile(path.join(output.acquisitionDir, "latest.json"), "utf8"));
    assert.equal(latest.diagnostics.length, 1);
    assert.doesNotMatch(JSON.stringify(latest), new RegExp(secret));
  } finally {
    await server.close();
  }
});

test("CLI returns nonzero status and validation issues for malformed JSON", async () => {
  const directory = await temporaryDirectory();
  const sourcesPath = path.join(directory, "sources.json");
  const candidatesPath = path.join(directory, "source-candidates.json");
  await writeFile(sourcesPath, "{ not valid json", "utf8");
  await writeFile(candidatesPath, JSON.stringify({ version: 1, candidates: [] }), "utf8");
  const output = paths(directory);

  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    ACQUIRE_CLI,
    "--sources",
    sourcesPath,
    "--candidates",
    candidatesPath,
    "--out",
    output.acquisitionDir,
    "--manifest",
    output.manifestPath,
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sources\.json|JSON|validation/i);
  assert.equal(existsSync(output.manifestPath), false);
});

async function acquireSources(options: Record<string, unknown>): Promise<AcquisitionResult> {
  const module = await import(ACQUIRE_MODULE);
  assert.equal(typeof module.acquireSources, "function", "lib/acquisition/acquire-sources must export acquireSources");
  return await module.acquireSources(options) as AcquisitionResult;
}

async function createServer(routes: Record<string, { status: number; contentType: string; body: string }>): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const route = routes[url.pathname] ?? { status: 404, contentType: "text/plain", body: "not found" };
    response.writeHead(route.status, { "content-type": route.contentType });
    response.end(route.body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  const port = (address as AddressInfo).port;

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function htmlGuide(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

async function temporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "votes-acquisition-"));
}

function paths(directory: string): { acquisitionDir: string; manifestPath: string } {
  return {
    acquisitionDir: path.join(directory, "acquisition"),
    manifestPath: path.join(directory, "ingestion-manifest.json"),
  };
}

async function writeSources(directory: string, sources: Array<Record<string, unknown>>): Promise<string> {
  const filePath = path.join(directory, "sources.json");
  await writeFile(filePath, `${JSON.stringify({ sources }, null, 2)}\n`, "utf8");
  return filePath;
}

async function writeCandidates(directory: string, candidates: Array<Record<string, unknown>>): Promise<string> {
  const filePath = path.join(directory, "source-candidates.json");
  await writeFile(filePath, `${JSON.stringify({ version: 1, candidates }, null, 2)}\n`, "utf8");
  return filePath;
}

function fixedClock(): () => Date {
  return () => new Date("2026-01-02T03:04:05.000Z");
}

function source(id: string): Record<string, unknown> {
  return {
    id,
    slug: id.replace(/^src-/, ""),
    name: `Source ${id}`,
    category: "Media / Editorial",
    sourceType: "publication guide / election coverage",
    status: "pending",
    homepageUrl: "https://example.test/",
    notes: "Test source registry row.",
  };
}

function candidate(sourceId: string, url: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceId,
    url,
    title: `Candidate for ${sourceId}`,
    kind: "public-guide",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

interface AcquisitionResult {
  ok: boolean;
  diagnostics: AcquisitionDiagnostic[];
}

interface AcquisitionDiagnostic {
  sourceId: string;
  phase: "candidate" | "fetch" | "capture" | "manifest" | "validate";
  status: "captured" | "skipped" | "http_error" | "timeout" | "unsupported_content" | "low_text" | "invalid_candidate" | "invalid_source";
  attemptedUrl?: string;
  capturedArtifactPath?: string;
  skippedReason?: string;
  error?: { code: string; message: string };
  timestamp: string;
  manifestIncluded: boolean;
  path?: string;
}
