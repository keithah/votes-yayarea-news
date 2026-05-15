import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildSourceCoverageReport } from "../../lib/ingestion/sourceCoverage";
import type { IngestionManifest, IngestionRunSummary } from "../../lib/ingestion/types";

test("buildSourceCoverageReport accepts complete non-sample captured and pending coverage", async () => {
  const fixture = await writeFixture({
    coverage: coverage([
      { sourceId: "src-alpha", status: "captured", targetId: "target-alpha", guideUrl: "https://example.org/alpha-guide" },
      { sourceId: "src-beta", status: "pending", reason: "Awaiting public guide URL." },
      { sourceId: "src-gamma", status: "manual-only", reason: "Manual capture required for dynamic page." },
    ]),
    run: runSummary([{ targetId: "target-alpha", sourceId: "src-alpha", artifactId: "art-alpha", fetchStatus: "fetched", importStatus: "imported" }]),
  });

  const report = await buildSourceCoverageReport({ ...fixture.options, now: fixedNow });

  assert.equal(report.ok, true);
  assert.equal(report.generatedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(
    pickCounts(report.counts),
    { sources: 3, captured: 1, pending: 1, manualOnly: 1, unavailable: 0, runtimeCaptured: 1, runtimeUnknown: 2, errors: 0, warnings: 0 },
  );
  assert.equal(report.sources.find((source) => source.sourceId === "src-alpha")?.artifactId, "art-alpha");
});

test("missing latest run still produces unknown runtime coverage", async () => {
  const fixture = await writeFixture({
    coverage: coverage([{ sourceId: "src-alpha", status: "captured", targetId: "target-alpha" }, { sourceId: "src-beta", status: "pending" }, { sourceId: "src-gamma", status: "excluded" }]),
    run: undefined,
  });

  const report = await buildSourceCoverageReport({ ...fixture.options, now: fixedNow });

  assert.equal(report.ok, true);
  assert.equal(report.counts.runtimeUnknown, 3);
  assert.equal(report.issues.length, 0);
});

test("duplicate and missing source coverage rows fail closed with path-qualified diagnostics", async () => {
  const fixture = await writeFixture({
    coverage: coverage([{ sourceId: "src-alpha", status: "pending" }, { sourceId: "src-alpha", status: "excluded" }]),
  });

  const report = await buildSourceCoverageReport(fixture.options);

  assertIssue(report, "duplicate_source_coverage", "source-coverage.json.sources[1].sourceId");
  assertIssue(report, "missing_source_coverage", "source-coverage.json.sources", "src-beta");
  assertIssue(report, "missing_source_coverage", "source-coverage.json.sources", "src-gamma");
  assert.equal(report.ok, false);
});

test("captured rows require known non-sample manifest targets", async () => {
  const fixture = await writeFixture({
    manifest: manifest([
      target({ id: "target-alpha", sourceId: "src-alpha", artifactId: "art-alpha", sampleFixture: true }),
      target({ id: "target-beta", sourceId: "src-beta", artifactId: "art-beta" }),
    ]),
    coverage: coverage([
      { sourceId: "src-alpha", status: "captured", targetId: "target-alpha" },
      { sourceId: "src-beta", status: "captured" },
      { sourceId: "src-gamma", status: "captured", targetId: "target-missing" },
    ]),
  });

  const report = await buildSourceCoverageReport(fixture.options);

  assertIssue(report, "sample_fixture_launch_coverage", "source-coverage.json.sources[0].targetId", "src-alpha");
  assertIssue(report, "captured_missing_target_id", "source-coverage.json.sources[1].targetId", "src-beta");
  assertIssue(report, "stale_coverage_target_id", "source-coverage.json.sources[2].targetId", "src-gamma");
});

test("manifest source IDs, stale run target IDs, and malformed URLs are diagnostics", async () => {
  const fixture = await writeFixture({
    publicSources: publicSources([{ id: "src-alpha", homepageUrl: "notaurl" }, { id: "src-beta", guideUrl: "ftp://example.org/guide" }, { id: "src-gamma" }]),
    manifest: manifest([target({ id: "target-alpha", sourceId: "src-missing", artifactId: "art-alpha", canonicalUrl: "also-bad" })]),
    coverage: coverage([{ sourceId: "src-alpha", status: "pending", guideUrl: "bad-guide" }, { sourceId: "src-beta", status: "pending" }, { sourceId: "src-gamma", status: "pending" }]),
    run: runSummary([{ targetId: "target-stale", sourceId: "src-alpha", artifactId: "art-alpha", fetchStatus: "fetched", importStatus: "imported" }]),
  });

  const report = await buildSourceCoverageReport(fixture.options);

  assertIssue(report, "invalid_url", "public-sources.json.sources[0].homepageUrl");
  assertIssue(report, "invalid_url", "public-sources.json.sources[1].guideUrl");
  assertIssue(report, "invalid_url", "source-coverage.json.sources[0].guideUrl");
  assertIssue(report, "unknown_manifest_source_id", "manifest.json.targets[0].sourceId");
  assertIssue(report, "invalid_url", "manifest.json.targets[0].canonicalUrl");
  assertIssue(report, "run_target_stale", "runs/latest.json.targets[0].targetId");
});

test("missing and malformed coverage inputs fail while malformed run is warning-only", async () => {
  const fixture = await writeFixture({ coverage: undefined, runBody: "{bad-run" });

  const missingCoverage = await buildSourceCoverageReport(fixture.options);
  assertIssue(missingCoverage, "missing_source_coverage_input", "source-coverage.json");
  assertIssue(missingCoverage, "run_summary_json_malformed", "runs/latest.json");
  assert.equal(missingCoverage.issues.find((issue) => issue.code === "run_summary_json_malformed")?.severity, "warning");

  await writeFile(fixture.options.coveragePath, "{bad-coverage", "utf8");
  const malformedCoverage = await buildSourceCoverageReport(fixture.options);
  assertIssue(malformedCoverage, "coverage_json_malformed", "source-coverage.json");
  assert.equal(malformedCoverage.ok, false);
});

test("CLI writes deterministic coverage report and exits nonzero on coverage errors", async () => {
  const passFixture = await writeFixture({
    coverage: coverage([{ sourceId: "src-alpha", status: "captured", targetId: "target-alpha" }, { sourceId: "src-beta", status: "pending" }, { sourceId: "src-gamma", status: "unavailable" }]),
    run: runSummary([{ targetId: "target-alpha", sourceId: "src-alpha", artifactId: "art-alpha", fetchStatus: "fetched", importStatus: "imported" }]),
  });
  const reportPath = path.join(passFixture.dir, "coverage/latest.json");
  const pass = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/report-source-coverage.ts",
      "--public-sources",
      passFixture.options.publicSourcesPath,
      "--manifest",
      passFixture.options.manifestPath,
      "--coverage",
      passFixture.options.coveragePath,
      "--run",
      passFixture.options.runPath,
      "--report",
      reportPath,
    ],
    { encoding: "utf8" },
  );

  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /"status": "pass"/);
  assert.equal(existsSync(reportPath), true);
  assert.equal(JSON.parse(await readFile(reportPath, "utf8")).ok, true);

  const failFixture = await writeFixture({ coverage: coverage([{ sourceId: "src-alpha", status: "pending" }]) });
  const fail = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/report-source-coverage.ts",
      "--public-sources",
      failFixture.options.publicSourcesPath,
      "--manifest",
      failFixture.options.manifestPath,
      "--coverage",
      failFixture.options.coveragePath,
      "--run",
      failFixture.options.runPath,
      "--report",
      path.join(failFixture.dir, "coverage/fail-latest.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /ERROR missing_source_coverage/);
});

test("canonical S02 manifests and generated diagnostics account for every source without legacy Mayor sample targets", async () => {
  const [publicSources, manifest, coverage, run, validation, generatedCoverage] = await Promise.all([
    readJson<{ sources: Array<{ id: string }> }>("data/public/sources.json"),
    readJson<{ targets: Array<{ id: string; sourceId: string; sampleFixture?: boolean }> }>("data/ingestion/manifest.json"),
    readJson<{ sources: Array<{ sourceId: string; status: string; targetId?: string }> }>("data/ingestion/source-coverage.json"),
    readJson<{ targets: Array<{ targetId: string; sourceId: string }> }>("data/ingested/runs/latest.json"),
    readJson<{ ok: boolean }>("data/ingested/validation/latest.json"),
    readJson<{ ok: boolean; sources: Array<{ sourceId: string; status: string; runtimeStatus: string; targetId?: string }> }>("data/ingested/coverage/latest.json"),
  ]);

  const publicSourceIds = publicSources.sources.map((source) => source.id).sort();
  const coverageSourceIds = coverage.sources.map((source) => source.sourceId).sort();
  const generatedCoverageSourceIds = generatedCoverage.sources.map((source) => source.sourceId).sort();
  assert.deepEqual(coverageSourceIds, publicSourceIds, "source-coverage.json must have exactly one row for every public source");
  assert.deepEqual(generatedCoverageSourceIds, publicSourceIds, "generated coverage/latest.json must account for every public source");

  assert.equal(validation.ok, true, "generated ingestion validation must be passing");
  assert.equal(generatedCoverage.ok, true, "generated source coverage diagnostics must be passing");
  assert.equal(manifest.targets.every((target) => target.sampleFixture === false), true, "launch manifest targets must be non-sample");

  const manifestTargetIds = new Set(manifest.targets.map((target) => target.id));
  for (const row of coverage.sources) {
    if (row.status === "captured") {
      assert.ok(row.targetId, `captured coverage row ${row.sourceId} must name a targetId`);
      assert.equal(manifestTargetIds.has(row.targetId), true, `captured coverage row ${row.sourceId} references unknown target ${row.targetId}`);
    }
  }

  const runTargetIds = run.targets.map((target) => target.targetId).sort();
  assert.deepEqual(runTargetIds, manifest.targets.map((target) => target.id).sort(), "latest run targets must match the launch manifest targets");

  assertNoLegacyMayorSampleLeak("data/ingestion/manifest.json", manifest);
  assertNoLegacyMayorSampleLeak("data/ingestion/source-coverage.json", coverage);
  assertNoLegacyMayorSampleLeak("data/ingested/runs/latest.json", run);
  assertNoLegacyMayorSampleLeak("data/ingested/validation/latest.json", validation);
  assertNoLegacyMayorSampleLeak("data/ingested/coverage/latest.json", generatedCoverage);
});

interface FixtureInput {
  publicSources?: unknown;
  manifest?: unknown;
  coverage?: unknown;
  run?: unknown;
  runBody?: string;
}

async function writeFixture(input: FixtureInput): Promise<{
  dir: string;
  options: { publicSourcesPath: string; manifestPath: string; coveragePath: string; runPath: string };
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "votes-source-coverage-"));
  const publicSourcesPath = path.join(dir, "public-sources.json");
  const manifestPath = path.join(dir, "manifest.json");
  const coveragePath = path.join(dir, "source-coverage.json");
  const runPath = path.join(dir, "runs/latest.json");

  await writeJson(publicSourcesPath, input.publicSources ?? publicSources());
  await writeJson(manifestPath, input.manifest ?? manifest());
  if (input.coverage !== undefined) {
    await writeJson(coveragePath, input.coverage);
  }
  if (input.runBody !== undefined) {
    await writeFileWithParents(runPath, input.runBody);
  } else if (input.run !== undefined) {
    await writeJson(runPath, input.run);
  }

  return { dir, options: { publicSourcesPath, manifestPath, coveragePath, runPath } };
}

function publicSources(overrides: Array<Record<string, unknown>> = []): unknown {
  const defaults = [
    { id: "src-alpha", name: "Alpha Guide", homepageUrl: "https://example.org/alpha", guideUrl: "https://example.org/alpha-guide" },
    { id: "src-beta", name: "Beta Guide", homepageUrl: "https://example.org/beta" },
    { id: "src-gamma", name: "Gamma Guide", homepageUrl: "https://example.org/gamma" },
  ];
  return { sources: overrides.length > 0 ? overrides : defaults };
}

function manifest(targets = [target()]): IngestionManifest {
  return { version: 1, description: "test manifest", targets };
}

function coverage(sources: unknown[]): unknown {
  return { version: 1, description: "test coverage", sources };
}

function target(overrides: Partial<IngestionManifest["targets"][number]> = {}): IngestionManifest["targets"][number] {
  return {
    id: "target-alpha",
    sourceId: "src-alpha",
    artifactId: "art-alpha",
    title: "Alpha guide",
    inputKind: "html",
    fixturePath: "alpha.html",
    canonicalUrl: "https://example.org/alpha-guide",
    sampleFixture: false,
    ...overrides,
  };
}

function runSummary(targets: IngestionRunSummary["targets"]): IngestionRunSummary {
  return {
    id: "run-test",
    status: "complete",
    startedAt: "2026-01-02T03:04:05.000Z",
    completedAt: "2026-01-02T03:04:06.000Z",
    phases: [],
    targets,
    artifacts: [],
    counts: { targets: targets.length, artifacts: 0, chunks: 0, issues: 0, errors: 0, warnings: 0 },
    issues: [],
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFileWithParents(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function assertNoLegacyMayorSampleLeak(label: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(
    serialized,
    /fixture-sf-chronicle-mayor-sample|fixture-growsf-mayor-sample|src-sf-chronicle-mayor-sample|src-growsf-mayor-sample|mayor-sample|sample-voter-guide|sample-2026|race-mayor|ent-sample-candidate/i,
    `${label} references legacy Mayor sample fixture content`,
  );
}

async function writeFileWithParents(filePath: string, body: string): Promise<void> {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  await writeFile(filePath, body, "utf8");
}

function fixedNow(): Date {
  return new Date("2026-01-02T03:04:05.000Z");
}

function pickCounts(counts: {
  sources: number;
  captured: number;
  pending: number;
  manualOnly: number;
  unavailable: number;
  runtimeCaptured: number;
  runtimeUnknown: number;
  errors: number;
  warnings: number;
}): Record<string, number> {
  return {
    sources: counts.sources,
    captured: counts.captured,
    pending: counts.pending,
    manualOnly: counts.manualOnly,
    unavailable: counts.unavailable,
    runtimeCaptured: counts.runtimeCaptured,
    runtimeUnknown: counts.runtimeUnknown,
    errors: counts.errors,
    warnings: counts.warnings,
  };
}

function assertIssue(result: { issues: Array<{ code: string; path: string; sourceId?: string }> }, code: string, pathIncludes: string, sourceId?: string): void {
  assert.equal(
    result.issues.some((issue) => issue.code === code && issue.path.includes(pathIncludes) && (!sourceId || issue.sourceId === sourceId)),
    true,
    `Expected ${code} at path containing ${pathIncludes}; got ${JSON.stringify(result.issues, null, 2)}`,
  );
}
