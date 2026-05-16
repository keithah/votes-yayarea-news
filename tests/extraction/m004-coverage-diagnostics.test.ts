import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface SourceRaceCoverageArtifact {
  ok: boolean;
  checkedFiles: string[];
  counts: {
    registeredSourceCount: number;
    raceCount: number;
    totalMatrixRows: number;
    reviewedPublicRows: number;
  };
  byRace: Array<{
    raceSlug: string;
    sources: SourceRaceRow[];
  }>;
}

interface SourceRaceRow {
  raceSlug: string;
  sourceId: string;
  sourceName: string;
  status: string;
  positionIds: string[];
  publicPositionIds: string[];
  reviewedPublicPositionIds: string[];
  unpublishedDiagnostics: UnpublishedDiagnostic[];
  unpublishedReasonCounts: Record<string, number>;
}

interface ReviewedPositionCoverageArtifact {
  ok: boolean;
  checkedFiles: string[];
  counts: {
    publicPositions: number;
    reviewedPublicPositions: number;
    informational: number;
  };
  byRace: Array<{
    raceSlug: string;
    publicPositions: number;
    byKind: Record<string, number>;
  }>;
  bySource: Array<{
    sourceId: string;
    name: string;
    coverageStatus: string;
    positions: number;
    publicPositions: number;
  }>;
  unpublished: ReviewedUnpublishedDiagnostic[];
  unpublishedCounts: {
    total: number;
    byStatus: Record<string, number>;
    byReasonCode: Record<string, number>;
  };
}

interface ReviewedUnpublishedDiagnostic extends UnpublishedDiagnostic {
  diagnosticPath: string;
  sourceName?: string;
  entityName?: string;
}

interface UnpublishedDiagnostic {
  status: string;
  phase: string;
  reasonCode: string;
  path?: string;
  message: string;
  raceId?: string;
  raceSlug?: string;
  sourceId?: string;
  entityId?: string;
  positionId?: string;
}

const S02_DIAGNOSTICS_PATH = "data/reviewed/m004-s02-bulk-latest.json";
const SOS_SOURCE_ID = "src-ca-secretary-of-state";
const GROWSF_SOURCE_ID = "src-growsf";
const CHRONICLE_SOURCE_ID = "src-sf-chronicle";
const SAD17_RACE_SLUG = "state-assembly-district-17";
const SAD17_PUBLIC_POSITION_ID = "pos-m004-s02-sos-state-assembly-district-17-matt-haney-informational";
const SAD17_DUPLICATE_POSITION_ID = "pos-m004-s02-sos-state-assembly-district-17-matt-haney-informational-duplicate";

test("M004 S03 artifacts prove both coverage reports checked the S02 bulk diagnostics", async () => {
  const { sourceRace, reviewed } = await loadArtifacts();

  assert.equal(sourceRace.ok, true);
  assert.equal(reviewed.ok, true);
  assertCheckedFile(sourceRace.checkedFiles, S02_DIAGNOSTICS_PATH, "source/race coverage");
  assertCheckedFile(reviewed.checkedFiles, S02_DIAGNOSTICS_PATH, "reviewed-position coverage");
});

test("source/race matrix preserves the current 24 by 21 M004 truth matrix", async () => {
  const { sourceRace } = await loadArtifacts();

  assert.equal(sourceRace.counts.registeredSourceCount, 24, "registered source count changed; refresh the expected M004 matrix contract intentionally if this is valid");
  assert.equal(sourceRace.counts.raceCount, 21, "race count changed; refresh the expected M004 matrix contract intentionally if this is valid");
  assert.equal(sourceRace.counts.totalMatrixRows, 24 * 21, "matrix must remain one row for every registered source/race pair");
  assert.ok(sourceRace.byRace.every((race) => race.sources.length === sourceRace.counts.registeredSourceCount), "each race must include every registered source");
});

test("State Assembly District 17 has the reviewed public Secretary of State informational position in both reports", async () => {
  const { sourceRace, reviewed } = await loadArtifacts();
  const sosSad17Row = sourceRaceRow(sourceRace, SAD17_RACE_SLUG, SOS_SOURCE_ID);
  const reviewedSad17 = reviewed.byRace.find((race) => race.raceSlug === SAD17_RACE_SLUG);
  const reviewedSos = reviewed.bySource.find((source) => source.sourceId === SOS_SOURCE_ID);

  assert.equal(sosSad17Row.status, "reviewed-public-position");
  assert.deepEqual(sosSad17Row.publicPositionIds, [SAD17_PUBLIC_POSITION_ID]);
  assert.deepEqual(sosSad17Row.reviewedPublicPositionIds, [SAD17_PUBLIC_POSITION_ID]);
  assert.equal(sosSad17Row.unpublishedReasonCounts.duplicate_public_claim, 1, "duplicate SOS SAD17 diagnostic should remain explained separately from the public row");

  assert.ok(reviewedSad17, "reviewed-position report must include State Assembly District 17");
  assert.equal(reviewedSad17.publicPositions, 1);
  assert.equal(reviewedSad17.byKind.informational, 1);
  assert.ok(reviewedSos, "reviewed-position report must include Secretary of State source summary");
  assert.equal(reviewedSos.coverageStatus, "captured");
  assert.equal(reviewedSos.publicPositions, reviewed.counts.publicPositions);
  assert.equal(reviewed.counts.publicPositions, reviewed.counts.reviewedPublicPositions);
  assert.ok(reviewed.counts.informational >= reviewedSad17.publicPositions);
});

test("known hidden, rejected, and duplicate S02 diagnostics keep their reason-code explanations", async () => {
  const { sourceRace, reviewed } = await loadArtifacts();

  assert.equal(reviewed.unpublishedCounts.total, 5, "M004 S02 unpublished diagnostic count changed unexpectedly");
  assert.deepEqual(reviewed.unpublishedCounts.byReasonCode, {
    duplicate_public_claim: 1,
    not_requested_public: 1,
    source_not_in_race: 3,
  });
  assert.equal(reviewed.unpublishedCounts.byStatus.hidden, 2);
  assert.equal(reviewed.unpublishedCounts.byStatus.rejected, 3);

  assertReviewedDiagnostic(reviewed, {
    diagnosticPath: "pos-m004-s02-growsf-governor-matt-mahan-hidden",
    sourceId: GROWSF_SOURCE_ID,
    raceSlug: "california-governor",
    status: "hidden",
    reasonCode: "not_requested_public",
  });
  assertReviewedDiagnostic(reviewed, {
    diagnosticPath: "pos-m004-s02-chronicle-governor-katie-porter",
    sourceId: CHRONICLE_SOURCE_ID,
    raceSlug: "california-governor",
    status: "rejected",
    reasonCode: "source_not_in_race",
  });
  assertReviewedDiagnostic(reviewed, {
    diagnosticPath: "pos-m004-s02-growsf-us-house-district-11-scott-wiener",
    sourceId: GROWSF_SOURCE_ID,
    raceSlug: "us-house-district-11",
    status: "rejected",
    reasonCode: "source_not_in_race",
  });
  assertReviewedDiagnostic(reviewed, {
    diagnosticPath: SAD17_DUPLICATE_POSITION_ID,
    sourceId: SOS_SOURCE_ID,
    raceSlug: SAD17_RACE_SLUG,
    status: "hidden",
    reasonCode: "duplicate_public_claim",
  });

  assert.equal(sourceRaceRow(sourceRace, "california-governor", GROWSF_SOURCE_ID).unpublishedReasonCounts.not_requested_public, 1);
  assert.equal(sourceRaceRow(sourceRace, "california-governor", CHRONICLE_SOURCE_ID).unpublishedReasonCounts.source_not_in_race, 1);
  assert.equal(sourceRaceRow(sourceRace, "us-house-district-11", GROWSF_SOURCE_ID).unpublishedReasonCounts.source_not_in_race, 1);
  assert.equal(sourceRaceRow(sourceRace, SAD17_RACE_SLUG, SOS_SOURCE_ID).unpublishedReasonCounts.duplicate_public_claim, 1);
});

test("diagnostics-only source/race rows never mint public position identifiers", async () => {
  const { sourceRace } = await loadArtifacts();
  const diagnosticRows = sourceRace.byRace.flatMap((race) => race.sources).filter((row) => row.unpublishedDiagnostics.length > 0);
  const diagnosticsOnlyRows = diagnosticRows.filter((row) => row.status !== "reviewed-public-position" && row.status !== "awaiting-review");

  assert.ok(diagnosticRows.length > 0, "fixture must contain S02 unpublished diagnostics");
  assert.ok(diagnosticsOnlyRows.length > 0, "fixture must contain diagnostics-only rows");
  assert.ok(
    diagnosticsOnlyRows.every((row) => row.publicPositionIds.length === 0 && row.reviewedPublicPositionIds.length === 0),
    "hidden/rejected diagnostics must not inflate public coverage counts",
  );
  assert.equal(sourceRace.counts.reviewedPublicRows, 2, "diagnostics-only rows must not increase reviewed public source/race rows");
});

async function loadArtifacts(): Promise<{ sourceRace: SourceRaceCoverageArtifact; reviewed: ReviewedPositionCoverageArtifact }> {
  const [sourceRace, reviewed] = await Promise.all([
    readJson<SourceRaceCoverageArtifact>("data/public/source-race-coverage.json"),
    readJson<ReviewedPositionCoverageArtifact>("data/reviewed/position-coverage.json"),
  ]);
  return { sourceRace, reviewed };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(process.cwd(), filePath), "utf8")) as T;
}

function sourceRaceRow(artifact: SourceRaceCoverageArtifact, raceSlug: string, sourceId: string): SourceRaceRow {
  const race = artifact.byRace.find((item) => item.raceSlug === raceSlug);
  assert.ok(race, `Expected source/race artifact to include race ${raceSlug}`);
  const row = race.sources.find((item) => item.sourceId === sourceId);
  assert.ok(row, `Expected source/race artifact to include ${sourceId} for ${raceSlug}`);
  return row;
}

function assertCheckedFile(checkedFiles: string[], filePath: string, label: string): void {
  assert.ok(checkedFiles.includes(filePath), `${label} must record checked file ${filePath}; got ${JSON.stringify(checkedFiles, null, 2)}`);
}

function assertReviewedDiagnostic(
  artifact: ReviewedPositionCoverageArtifact,
  expected: { diagnosticPath: string; sourceId: string; raceSlug: string; status: string; reasonCode: string },
): void {
  assert.ok(
    artifact.unpublished.some(
      (item) =>
        item.diagnosticPath === expected.diagnosticPath &&
        item.sourceId === expected.sourceId &&
        item.raceSlug === expected.raceSlug &&
        item.status === expected.status &&
        item.reasonCode === expected.reasonCode,
    ),
    `Expected reviewed diagnostic ${JSON.stringify(expected)} in ${JSON.stringify(artifact.unpublished, null, 2)}`,
  );
}
