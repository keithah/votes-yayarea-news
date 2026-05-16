import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildDurableSourceRaceCoverageReport, buildSourceRaceCoverageReport, type DurableSourceRaceCoverageReport, type SourceCoverageLedger } from "../../lib/data/sourceRaceCoverage";
import { listRaceSlugs, loadRaceData } from "../../lib/data/loaders";
import type { Position, Race, Source } from "../../lib/data/types";

const REVIEWED_EVIDENCE = {
  id: "ev-alpha-mayor",
  sourceId: "src-alpha",
  entityId: "ent-mayor-a",
  raceId: "race-mayor",
  url: "https://example.org/alpha",
  kind: "quote" as const,
  quote: "Alpha endorses Candidate A.",
};

test("buildSourceRaceCoverageReport emits one row per race/source and explicit contract states", () => {
  const sources = [source("src-alpha"), source("src-beta"), source("src-gamma"), source("src-delta"), source("src-epsilon")];
  const races = [
    race("mayor", [position({ sourceId: "src-alpha", status: "verified", publicationStatus: "public", evidenceIds: [REVIEWED_EVIDENCE.id], evidence: [REVIEWED_EVIDENCE] })]),
    race("controller", [position({ id: "pos-beta", raceId: "race-controller", sourceId: "src-beta", status: "reviewed", publicationStatus: "public" })]),
    race("empty"),
  ];
  const report = buildSourceRaceCoverageReport({
    sources,
    races,
    sourceCoverage: ledger([
      { sourceId: "src-alpha", status: "captured", relevantRaceSlugs: ["mayor"] },
      { sourceId: "src-beta", status: "captured", relevantRaceSlugs: ["controller", "empty"] },
      { sourceId: "src-gamma", status: "pending" },
      { sourceId: "src-delta", status: "manual-only", ballotUniverseGaps: ["empty"] },
      { sourceId: "src-epsilon", status: "unavailable" },
    ]),
  });

  assert.equal(report.ok, true);
  assert.equal(report.counts.rows, 15);
  assert.equal(row(report, "mayor", "src-alpha")?.status, "reviewed-public-position");
  assert.equal(row(report, "controller", "src-beta")?.status, "awaiting-review");
  assert.equal(row(report, "empty", "src-beta")?.status, "no-public-position-found");
  assert.equal(row(report, "empty", "src-gamma")?.status, "pending-capture");
  assert.equal(row(report, "empty", "src-delta")?.status, "manual-only");
  assert.equal(row(report, "empty", "src-epsilon")?.status, "no-public-source-found");
  assert.equal(row(report, "controller", "src-alpha")?.status, "not-applicable");
});

test("negative diagnostics are path-qualified for malformed ledger status, duplicates, unknown sources, unknown race slugs, and missing rows", () => {
  const report = buildSourceRaceCoverageReport({
    sources: [source("src-alpha"), source("src-beta")],
    races: [race("mayor")],
    sourceCoveragePath: "coverage.json",
    sourceCoverage: ledger([
      { sourceId: "src-alpha", status: "wat", relevantRaceSlugs: ["missing-race"] },
      { sourceId: "src-alpha", status: "pending" },
      { sourceId: "src-unknown", status: "pending", ballotUniverseGaps: ["also-missing"] },
    ]),
  });

  assert.equal(report.ok, false);
  assertIssue(report, "invalid_coverage_status", "coverage.json.sources[0].status");
  assertIssue(report, "unknown_race_slug", "coverage.json.sources[0].relevantRaceSlugs[0]");
  assertIssue(report, "duplicate_coverage_source_id", "coverage.json.sources[1].sourceId");
  assertIssue(report, "unknown_coverage_source_id", "coverage.json.sources[2].sourceId");
  assertIssue(report, "unknown_race_slug", "coverage.json.sources[2].ballotUniverseGaps[0]");
  assertIssue(report, "missing_coverage_row", "coverage.json.sources", "src-beta");
});

test("boundary cases cover zero races, zero sources, one reviewed informational position, and all-pending ledgers", () => {
  assert.equal(buildSourceRaceCoverageReport({ sources: [source("src-alpha")], races: [], sourceCoverage: ledger([{ sourceId: "src-alpha", status: "pending" }]) }).counts.rows, 0);
  assert.equal(buildSourceRaceCoverageReport({ sources: [], races: [race("mayor")], sourceCoverage: ledger([]) }).counts.rows, 0);

  const reviewed = buildSourceRaceCoverageReport({
    sources: [source("src-alpha")],
    races: [race("mayor", [position({ kind: "informational", evidenceIds: [REVIEWED_EVIDENCE.id], evidence: [REVIEWED_EVIDENCE] })])],
    sourceCoverage: ledger([{ sourceId: "src-alpha", status: "captured", relevantRaceSlugs: ["mayor"] }]),
  });
  assert.equal(reviewed.counts.statuses["reviewed-public-position"], 1);
  assert.deepEqual(reviewed.rows[0]?.reviewedPublicPositionIds, ["pos-alpha"]);

  const pending = buildSourceRaceCoverageReport({
    sources: [source("src-alpha"), source("src-beta")],
    races: [race("mayor"), race("controller")],
    sourceCoverage: ledger([{ sourceId: "src-alpha", status: "pending" }, { sourceId: "src-beta", status: "pending" }]),
  });
  assert.equal(pending.counts.rows, 4);
  assert.equal(pending.counts.statuses["pending-capture"], 4);
});

test("race with no positions still emits one coverage row per registered source", () => {
  const report = buildSourceRaceCoverageReport({
    sources: [source("src-alpha"), source("src-beta"), source("src-gamma")],
    races: [race("empty")],
    sourceCoverage: ledger([{ sourceId: "src-alpha", status: "captured" }, { sourceId: "src-beta", status: "pending" }, { sourceId: "src-gamma", status: "manual-only" }]),
  });

  assert.deepEqual(report.rows.map((item) => item.sourceId), ["src-alpha", "src-beta", "src-gamma"]);
  assert.deepEqual(report.rows.map((item) => item.status), ["no-public-position-found", "pending-capture", "manual-only"]);
});

test("current repository data builds the 24 by 21 source/race truth matrix", async () => {
  const [sourcesFile, sourceCoverage, raceSlugs] = await Promise.all([
    readJson<{ sources: Source[] }>("data/public/sources.json"),
    readJson<SourceCoverageLedger>("data/ingestion/source-coverage.json"),
    listRaceSlugs(),
  ]);
  const loadedRaces = await Promise.all(raceSlugs.map((slug) => loadRaceData(slug)));
  const races = loadedRaces.map((loaded) => {
    assert.ok(loaded);
    return loaded.race;
  });

  const report = buildSourceRaceCoverageReport({ sources: sourcesFile.sources, races, sourceCoverage, sourceCoveragePath: "data/ingestion/source-coverage.json" });

  assert.equal(report.ok, true, report.issues.map((issue) => `${issue.code}:${issue.path}`).join("\n"));
  assert.equal(report.counts.sources, 24);
  assert.equal(report.counts.races, 21);
  assert.equal(report.counts.rows, 504);
  assert.equal(row(report, "california-governor", "src-ca-secretary-of-state")?.status, "reviewed-public-position");
  assert.equal(row(report, "california-governor", "src-ca-secretary-of-state")?.reviewedPublicPositionIds.length, 61);
  assert.equal(row(report, "california-secretary-of-state", "src-ca-secretary-of-state")?.status, "no-public-position-found");
  assert.equal(row(report, "california-secretary-of-state", "src-ca-secretary-of-state")?.ledgerStatus, "captured");
  assert.ok(report.counts.statuses["pending-capture"] > 0, "pending source ledger rows must remain explicit pending coverage");
  assert.ok(report.counts.statuses["not-applicable"] > 0, "coverage metadata should emit at least one not-applicable row");
});

test("durable source/race coverage artifact has deterministic race and source summaries", async () => {
  const { artifact, report, raceSlugs, sources } = await buildCurrentDurableArtifact("2026-01-01T00:00:00.000Z");

  assert.equal(artifact.ok, true);
  assert.equal(artifact.generatedAt, "2026-01-01T00:00:00.000Z");
  assert.ok(artifact.checkedFiles.includes("data/ingestion/source-coverage.json"));
  assert.ok(artifact.checkedFiles.includes("data/public/sources.json"));
  assert.equal(artifact.counts.registeredSourceCount, 24);
  assert.equal(artifact.counts.raceCount, 21);
  assert.equal(artifact.counts.totalMatrixRows, 504);
  assert.equal(artifact.counts.reviewedPublicRows, report.counts.statuses["reviewed-public-position"]);
  assert.equal(artifact.counts.awaitingReviewRows, report.counts.statuses["awaiting-review"]);
  assert.equal(artifact.counts.pendingCaptureRows, report.counts.statuses["pending-capture"]);
  assert.equal(artifact.counts.manualOnlyRows, report.counts.statuses["manual-only"]);
  assert.equal(artifact.counts.noPublicSourceFoundRows, report.counts.statuses["no-public-source-found"]);
  assert.equal(artifact.counts.noPublicPositionFoundRows, report.counts.statuses["no-public-position-found"]);
  assert.equal(artifact.counts.notApplicableRows, report.counts.statuses["not-applicable"]);
  assert.deepEqual(artifact.byRace.map((item) => item.raceSlug), [...raceSlugs].sort());
  assert.ok(artifact.byRace.every((raceSummary) => raceSummary.sources.length === 24));
  assert.deepEqual(artifact.bySource.map((item) => item.sourceId), [...sources.map((source) => source.id)].sort());
  assert.ok(artifact.bySource.every((sourceSummary) => sourceSummary.races.length === 21));
});

test("checked-in source/race coverage artifact is fresh, well-formed, exhaustive, and does not mint public positions from coverage statuses", async () => {
  const actual = await readJson<DurableSourceRaceCoverageReport>("data/public/source-race-coverage.json");
  const { artifact: expected } = await buildCurrentDurableArtifact(actual.generatedAt);

  assert.equal(typeof actual.generatedAt, "string");
  assert.ok(actual.generatedAt.length > 0, "generated artifact must include a generatedAt timestamp");
  assert.deepEqual(actual, expected);
  assert.equal(actual.counts.registeredSourceCount, 24);
  assert.equal(actual.counts.raceCount, 21);
  assert.equal(actual.counts.totalMatrixRows, actual.counts.registeredSourceCount * actual.counts.raceCount);
  assert.ok(actual.byRace.every((raceSummary) => raceSummary.sources.length === actual.counts.registeredSourceCount));
  assert.ok(actual.bySource.every((sourceSummary) => sourceSummary.races.length === actual.counts.raceCount));

  const coverageOnlyRows = actual.byRace.flatMap((raceSummary) => raceSummary.sources).filter((row) => row.status !== "reviewed-public-position" && row.status !== "awaiting-review");
  assert.ok(coverageOnlyRows.length > 0, "fixture must exercise coverage-only statuses");
  assert.ok(coverageOnlyRows.every((row) => row.publicPositionIds.length === 0 && row.reviewedPublicPositionIds.length === 0));
});

async function buildCurrentDurableArtifact(generatedAt: string): Promise<{
  artifact: DurableSourceRaceCoverageReport;
  report: ReturnType<typeof buildSourceRaceCoverageReport>;
  raceSlugs: string[];
  sources: Source[];
}> {
  const [sourcesFile, sourceCoverage, raceSlugs] = await Promise.all([
    readJson<{ sources: Source[] }>("data/public/sources.json"),
    readJson<SourceCoverageLedger>("data/ingestion/source-coverage.json"),
    listRaceSlugs(),
  ]);
  const loadedRaces = await Promise.all(raceSlugs.map((slug) => loadRaceData(slug)));
  const races = loadedRaces.map((loaded) => {
    assert.ok(loaded);
    return loaded.race;
  });
  const report = buildSourceRaceCoverageReport({ sources: sourcesFile.sources, races, sourceCoverage, sourceCoveragePath: "data/ingestion/source-coverage.json" });
  const checkedFiles = [
    "data/public/sources.json",
    "data/ingestion/source-coverage.json",
    ...raceSlugs.map((slug) => `data/public/races/${slug}.json`),
  ];
  const artifact = buildDurableSourceRaceCoverageReport(report, { generatedAt, checkedFiles });
  return { artifact, report, raceSlugs, sources: sourcesFile.sources };
}

function source(id: string): Source {
  return { id, slug: id.replace(/^src-/, ""), name: id, category: "Fixture", sourceType: "fixture", status: "active" };
}

function race(slug: string, positions: Position[] = []): Race {
  return {
    id: `race-${slug}`,
    slug,
    title: slug,
    kind: "other",
    status: "verified",
    publicationStatus: "public",
    electionDate: "2026-06-02",
    jurisdiction: "Fixture",
    entityIds: ["ent-mayor-a"],
    sourceIds: [...new Set(positions.map((item) => item.sourceId))],
    positions,
  };
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-alpha",
    raceId: "race-mayor",
    sourceId: "src-alpha",
    entityId: "ent-mayor-a",
    kind: "endorse",
    status: "verified",
    publicationStatus: "public",
    label: "Fixture position",
    evidenceIds: [],
    evidence: [],
    ...overrides,
  };
}

function ledger(sources: NonNullable<SourceCoverageLedger["sources"]>): SourceCoverageLedger {
  return { sources };
}

function row(report: ReturnType<typeof buildSourceRaceCoverageReport>, raceSlug: string, sourceId: string) {
  return report.rows.find((item) => item.raceSlug === raceSlug && item.sourceId === sourceId);
}

function assertIssue(report: ReturnType<typeof buildSourceRaceCoverageReport>, code: string, issuePath: string, sourceId?: string): void {
  assert.ok(
    report.issues.some((issue) => issue.code === code && issue.path === issuePath && (sourceId === undefined || issue.sourceId === sourceId)),
    `Expected issue ${code} at ${issuePath}`,
  );
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(process.cwd(), filePath), "utf8")) as T;
}
