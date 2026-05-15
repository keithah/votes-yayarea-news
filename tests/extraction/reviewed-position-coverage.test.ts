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
    sourceId: "src-sf-chronicle",
    evidenceIds: ["ev-test-public-no-position"],
    evidence: [
      {
        id: "ev-test-public-no-position",
        sourceId: "src-sf-chronicle",
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
    sourceId: "src-sf-chronicle",
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

function assertIssue(issues: { code: string; path: string }[], code: string, pathPattern: RegExp): void {
  const match = issues.find((issue) => issue.code === code);
  assert.ok(match, `Expected ${code}; got ${JSON.stringify(issues, null, 2)}`);
  assert.match(match.path, pathPattern);
}
