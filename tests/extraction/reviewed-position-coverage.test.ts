import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReviewedPositionCoverageReport, writeReviewedPositionCoverageReport } from "../../lib/review/coverage";

test("reviewed coverage reports current public position counts without unsupported publication issues", async () => {
  const report = await buildReviewedPositionCoverageReport({ now: fixedNow });

  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
  assert.equal(report.counts.publicPositions > 0, true);
  assert.equal(report.counts.informational > 0, true);
  assert.equal(report.counts.errors, 0);
  assert.equal(report.bySource.some((source) => source.sourceId === "src-ca-secretary-of-state" && source.coverageStatus === "captured"), true);
});

test("reviewed coverage flags unsupported public no-position records from uncaptured sources", async () => {
  const fixture = await createFixture();
  await writeOverridePosition(fixture, {
    id: "pos-test-public-no-position",
    kind: "no-position",
    sourceId: "src-mission-local",
    evidenceIds: ["ev-test-public-no-position"],
    evidence: [
      {
        id: "ev-test-public-no-position",
        sourceId: "src-mission-local",
        entityId: "ent-california-governor-akinyemi-agbede",
        raceId: "race-california-governor",
        url: "https://example.test/no-position",
        kind: "quote",
        quote: "The source explicitly states it makes no endorsement in this race.",
      },
    ],
  });

  const report = await buildReviewedPositionCoverageReport({ ...fixture.options, now: fixedNow });

  assert.equal(report.ok, false);
  assertIssue(report.issues, "unsupported_public_recommendation_source", /data\/public\/races\/california-governor\.json\.race\.positions\[\d+\]\.sourceId/);
});

test("reviewed coverage flags unsupported public endorsements and missing evidence", async () => {
  const fixture = await createFixture();
  await writeOverridePosition(fixture, {
    id: "pos-test-public-endorsement",
    kind: "endorse",
    sourceId: "src-mission-local",
    evidenceIds: [],
    evidence: [],
  });

  const report = await buildReviewedPositionCoverageReport({ ...fixture.options, now: fixedNow });

  assert.equal(report.ok, false);
  assertIssue(report.issues, "unsupported_public_recommendation_source", /california-governor\.json\.race\.positions\[\d+\]\.sourceId/);
  assertIssue(report.issues, "public_position_missing_evidence", /california-governor\.json\.race\.positions\[\d+\]\.evidence/);
});

test("reviewed coverage flags partial artifact and chunk provenance", async () => {
  const fixture = await createFixture();
  await writeOverridePosition(fixture, {
    id: "pos-test-partial-provenance",
    kind: "informational",
    sourceId: "src-ca-secretary-of-state",
    evidenceIds: ["ev-test-partial-provenance"],
    evidence: [
      {
        id: "ev-test-partial-provenance",
        sourceId: "src-ca-secretary-of-state",
        entityId: "ent-california-governor-akinyemi-agbede",
        raceId: "race-california-governor",
        artifactId: "art-ca-secretary-of-state-2026-primary-certified-candidates",
        url: "https://example.test/partial-provenance",
        kind: "quote",
        quote: "Candidate listed by the Secretary of State.",
      },
    ],
  });

  const report = await buildReviewedPositionCoverageReport({ ...fixture.options, now: fixedNow });

  assert.equal(report.ok, false);
  assert.equal(report.counts.provenancePartialEvidence, 1);
  assertIssue(report.issues, "partial_evidence_provenance", /chunkId/);
});


test("reviewed coverage preserves public counts when diagnostics are omitted", async () => {
  const withZeroDiagnosticsFixture = await createFixture();
  const withoutDiagnostics = await buildReviewedPositionCoverageReport({ ...withZeroDiagnosticsFixture.options, now: fixedNow });
  const diagnosticsPath = await writeBulkDiagnostics(withZeroDiagnosticsFixture, []);
  const withZeroDiagnostics = await buildReviewedPositionCoverageReport({ ...withZeroDiagnosticsFixture.options, bulkDiagnosticsPath: diagnosticsPath, now: fixedNow });

  assert.equal(withoutDiagnostics.unpublishedCounts.total, 0);
  assert.equal(withZeroDiagnostics.ok, true, JSON.stringify(withZeroDiagnostics.issues, null, 2));
  assert.equal(withZeroDiagnostics.counts.publicPositions, withoutDiagnostics.counts.publicPositions);
  assert.equal(withZeroDiagnostics.unpublishedCounts.total, 0);
  assert.equal(withZeroDiagnostics.checkedFiles.includes(path.relative(process.cwd(), diagnosticsPath)), true);
});

test("reviewed coverage fails visibly for supplied missing or malformed bulk diagnostics", async () => {
  const fixture = await createFixture();
  const missingPath = path.join(fixture.root, "missing-bulk.json");
  const missing = await buildReviewedPositionCoverageReport({ ...fixture.options, bulkDiagnosticsPath: missingPath, now: fixedNow });
  assert.equal(missing.ok, false);
  assertIssue(missing.issues, "coverage_input_missing", /missing-bulk\.json/);

  const malformedPath = path.join(fixture.root, "malformed-bulk.json");
  await fs.writeFile(malformedPath, "{not json", "utf8");
  const malformed = await buildReviewedPositionCoverageReport({ ...fixture.options, bulkDiagnosticsPath: malformedPath, now: fixedNow });
  assert.equal(malformed.ok, false);
  assertIssue(malformed.issues, "bulk_diagnostics_json_malformed", /malformed-bulk\.json/);
});

test("reviewed coverage summarizes hidden and rejected diagnostics by reason code without changing public positions", async () => {
  const fixture = await createFixture();
  const baseline = await buildReviewedPositionCoverageReport({ ...fixture.options, now: fixedNow });
  const diagnosticsPath = await writeBulkDiagnostics(fixture, [
    bulkIssue({ status: "hidden", reasonCode: "not_requested_public", path: "pos-hidden", sourceId: "src-growsf", entityId: "ent-california-governor-matt-mahan" }),
    bulkIssue({ status: "rejected", reasonCode: "source_not_in_race", path: "pos-rejected", sourceId: "src-sf-chronicle", entityId: "ent-california-governor-katie-porter" }),
  ]);

  const report = await buildReviewedPositionCoverageReport({ ...fixture.options, bulkDiagnosticsPath: diagnosticsPath, now: fixedNow });

  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
  assert.equal(report.counts.publicPositions, baseline.counts.publicPositions);
  assert.equal(report.unpublishedCounts.total, 2);
  assert.equal(report.unpublishedCounts.byStatus.hidden, 1);
  assert.equal(report.unpublishedCounts.byStatus.rejected, 1);
  assert.deepEqual(report.unpublishedCounts.byReasonCode, { not_requested_public: 1, source_not_in_race: 1 });
  assert.equal(report.unpublished.find((item) => item.reasonCode === "not_requested_public")?.sourceName, "GrowSF Voter Guide");
});

test("reviewed coverage counts duplicate diagnostics deterministically", async () => {
  const fixture = await createFixture();
  const diagnosticsPath = await writeBulkDiagnostics(fixture, [
    bulkIssue({ status: "hidden", reasonCode: "duplicate_public_claim", path: "pos-duplicate-b" }),
    bulkIssue({ status: "hidden", reasonCode: "duplicate_public_claim", path: "pos-duplicate-a" }),
  ]);

  const report = await buildReviewedPositionCoverageReport({ ...fixture.options, bulkDiagnosticsPath: diagnosticsPath, now: fixedNow });

  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
  assert.equal(report.unpublishedCounts.byReasonCode.duplicate_public_claim, 2);
  assert.deepEqual(report.unpublished.map((item) => item.diagnosticPath), ["pos-duplicate-a", "pos-duplicate-b"]);
});

test("reviewed coverage surfaces malformed diagnostic rows and unknown identifiers", async () => {
  const fixture = await createFixture();
  const diagnosticsPath = await writeBulkDiagnostics(fixture, [
    bulkIssue({ reasonCode: undefined, path: "pos-missing-reason" }),
    bulkIssue({ reasonCode: "source_not_in_race", path: "pos-unknown", raceId: "race-unknown", sourceId: "src-unknown", entityId: "ent-unknown" }),
  ]);

  const report = await buildReviewedPositionCoverageReport({ ...fixture.options, bulkDiagnosticsPath: diagnosticsPath, now: fixedNow });

  assert.equal(report.ok, false);
  assert.equal(report.unpublishedCounts.byReasonCode.missing_reason_code, 1);
  assert.equal(report.unpublishedCounts.byReasonCode.source_not_in_race, 1);
  assertIssue(report.issues, "bulk_diagnostic_missing_reason_code", /bulk-diagnostics\.json\.issues\[0\]\.reasonCode/);
  assertIssue(report.issues, "unknown_bulk_diagnostic_race", /bulk-diagnostics\.json\.issues\[1\]\.raceId/);
  assertIssue(report.issues, "unknown_bulk_diagnostic_source", /bulk-diagnostics\.json\.issues\[1\]\.sourceId/);
  assertIssue(report.issues, "unknown_bulk_diagnostic_entity", /bulk-diagnostics\.json\.issues\[1\]\.entityId/);
});

test("reviewed coverage summarizes the known M004 S02 hidden and rejected reasons", async () => {
  const baseline = await buildReviewedPositionCoverageReport({ now: fixedNow });
  const report = await buildReviewedPositionCoverageReport({ bulkDiagnosticsPath: path.join(process.cwd(), "data", "reviewed", "m004-s02-bulk-latest.json"), now: fixedNow });

  assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2));
  assert.equal(report.counts.publicPositions, baseline.counts.publicPositions);
  assert.equal(report.unpublishedCounts.total, 2);
  assert.deepEqual(report.unpublishedCounts.byReasonCode, { duplicate_public_claim: 1, not_requested_public: 1 });
  assert.equal(report.unpublishedCounts.byStatus.hidden, 2);
  assert.equal(report.unpublishedCounts.byStatus.rejected ?? 0, 0);
  assert.equal(report.unpublished.some((item) => item.raceSlug === "state-assembly-district-17" && item.reasonCode === "duplicate_public_claim" && item.positionId === "pos-m004-s02-sos-state-assembly-district-17-matt-haney-informational-duplicate"), true);
});

test("reviewed coverage writes the deterministic report artifact", async () => {
  const fixture = await createFixture();
  const report = await buildReviewedPositionCoverageReport({ ...fixture.options, now: fixedNow });
  const reportPath = path.join(fixture.root, "data", "reviewed", "position-coverage.json");

  await writeReviewedPositionCoverageReport(reportPath, report);

  const written = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(written.generatedAt, fixedNow().toISOString());
  assert.deepEqual(written.counts, report.counts);
});

interface Fixture {
  root: string;
  publicDir: string;
  overridesDir: string;
  options: {
    publicDir: string;
    overridesDir: string;
    sourceCoveragePath: string;
    ingestedCoveragePath: string;
    ingestedValidationPath: string;
  };
}

const fixedNow = () => new Date("2026-05-15T13:00:00.000Z");

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-reviewed-coverage-"));
  const publicDir = path.join(root, "data", "public");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  return {
    root,
    publicDir,
    overridesDir,
    options: {
      publicDir,
      overridesDir,
      sourceCoveragePath: path.join(process.cwd(), "data", "ingestion", "source-coverage.json"),
      ingestedCoveragePath: path.join(process.cwd(), "data", "ingested", "coverage", "latest.json"),
      ingestedValidationPath: path.join(process.cwd(), "data", "ingested", "validation", "latest.json"),
    },
  };
}

async function writeOverridePosition(
  fixture: Fixture,
  position: {
    id: string;
    kind: "endorse" | "no-position" | "informational";
    sourceId: string;
    evidenceIds: string[];
    evidence: Array<Record<string, unknown>>;
  },
): Promise<void> {
  const overrideDir = path.join(fixture.overridesDir, "races");
  await fs.mkdir(overrideDir, { recursive: true });
  const overridePath = path.join(overrideDir, "california-governor.json");
  const override = {
    race: {
      sourceIds: [position.sourceId],
      positions: [
        {
          id: position.id,
          raceId: "race-california-governor",
          sourceId: position.sourceId,
          entityId: "ent-california-governor-akinyemi-agbede",
          kind: position.kind,
          status: "verified",
          publicationStatus: "public",
          label: "Test reviewed public position",
          evidenceIds: position.evidenceIds,
          evidence: position.evidence,
        },
      ],
    },
  };
  await fs.writeFile(overridePath, `${JSON.stringify(override, null, 2)}\n`, "utf8");
}


async function writeBulkDiagnostics(fixture: Fixture, issues: Array<Record<string, unknown>>): Promise<string> {
  const diagnosticsPath = path.join(fixture.root, "bulk-diagnostics.json");
  const diagnostics = {
    ok: true,
    generatedAt: fixedNow().toISOString(),
    checkedFiles: ["data/extracted/drafts/test-bulk.json"],
    sourceDraftPath: "data/extracted/drafts/test-bulk.json",
    diagnosticsPath: path.relative(process.cwd(), diagnosticsPath),
    counts: {
      positions: issues.length,
      races: 1,
      published: 0,
      public: 0,
      hidden: issues.filter((issue) => issue.status === "hidden").length,
      rejected: issues.filter((issue) => issue.status === "rejected").length,
      errors: issues.filter((issue) => issue.status === "error").length,
      issues: issues.length,
    },
    races: [],
    issues,
  };
  await fs.writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
  return diagnosticsPath;
}

function bulkIssue(overrides: { status?: string; phase?: string; reasonCode?: string; path?: string; raceId?: string; sourceId?: string; entityId?: string } = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    phase: "review",
    status: "hidden",
    reasonCode: "not_requested_public",
    path: "pos-test-unpublished",
    message: "Test diagnostic summary.",
    raceId: "race-california-governor",
    sourceId: "src-growsf",
    entityId: "ent-california-governor-matt-mahan",
    positionId: "pos-test-unpublished",
    artifactId: "art-test",
    chunkId: "chunk-test",
    evidenceId: "ev-test",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  return base;
}

function assertIssue(issues: { code: string; path: string }[], code: string, pathPattern: RegExp): void {
  const match = issues.find((issue) => issue.code === code);
  assert.ok(match, `Expected ${code}; got ${JSON.stringify(issues, null, 2)}`);
  assert.match(match.path, pathPattern);
}
