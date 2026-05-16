import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadPublicRaceData } from "../../lib/data/loaders";
import { runExtraction } from "../../lib/extraction/run";
import type { ExtractionDraft } from "../../lib/extraction/types";
import { runBulkPositionReview } from "../../lib/review/bulk";
import type { PositionReviewFile } from "../../lib/review/positions";

const fixedNow = () => new Date("2026-05-15T12:30:00.000Z");

test("bulk review publishes only evidence-backed reviewed public draft records", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => markPublic(draft));

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.published, 1);
  assert.equal(result.counts.public, 1);
  const publicRace = await loadPublicRaceData("california-governor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.ok(publicRace);
  assert.deepEqual(publicRace.race.positions.map((position) => position.id), ["pos-ca-secretary-of-state-california-governor-akinyemi-agbede-1"]);
  assert.equal((await pathExists(path.join(fixture.diagnosticsDir, "bulk-review-latest.json"))), true);
});

test("bulk review keeps hidden drafts out of overrides with diagnostics", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root);

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.published, 0);
  assertIssue(result.issues, "not_requested_public");
  assert.deepEqual((await loadPublicRaceData("california-governor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }))?.race.positions, []);
  assert.equal(await pathExists(path.join(fixture.overridesDir, "races", "california-governor.json")), false);
});

test("bulk review rejects missing evidence instead of publishing", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => {
    markPublic(draft);
    draft.positions[0].evidenceIds = [];
    draft.evidence = [];
  });

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.rejected, 1);
  assertIssue(result.issues, "missing_evidence");
  const review = await readReview(fixture.reviewsDir);
  assert.equal(review.positions[0].status, "rejected");
  assert.equal(review.positions[0].publicationStatus, "hidden");
  assert.equal(await pathExists(path.join(fixture.overridesDir, "races", "california-governor.json")), false);
});

test("bulk review rejects quotes missing from the referenced chunk", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => {
    markPublic(draft);
    draft.evidence[0].quote = "This quote does not appear in the source chunk.";
  });

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.rejected, 1);
  assertIssue(result.issues, "quote_not_in_chunk");
  assert.equal(await pathExists(path.join(fixture.overridesDir, "races", "california-governor.json")), false);
});

test("bulk review rejects unknown source and entity IDs before publish", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => {
    markPublic(draft);
    draft.positions[0].sourceId = "src-unknown";
    draft.positions[0].entityId = "ent-unknown";
    draft.evidence[0].sourceId = "src-unknown";
    draft.evidence[0].entityId = "ent-unknown";
  });

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.rejected, 1);
  assertIssue(result.issues, "unknown_source_id");
  assert.equal(await pathExists(path.join(fixture.overridesDir, "races", "california-governor.json")), false);
});

test("bulk review reports unknown race records without writing overrides", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => {
    markPublic(draft);
    draft.positions[0].raceId = "race-does-not-exist";
    draft.evidence[0].raceId = "race-does-not-exist";
  });

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assertIssue(result.issues, "unknown_race_id");
  assert.equal(result.counts.published, 0);
  assert.equal(await pathExists(path.join(fixture.overridesDir, "races", "california-governor.json")), false);
});

test("bulk review hides duplicate public source/race/entity/kind claims", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => {
    markPublic(draft);
    const duplicatePosition = { ...draft.positions[0], id: "pos-duplicate-claim", evidenceIds: ["ev-duplicate-claim"] };
    const duplicateEvidence = { ...draft.evidence[0], id: "ev-duplicate-claim", positionId: duplicatePosition.id };
    draft.positions.push(duplicatePosition);
    draft.evidence.push(duplicateEvidence);
  });

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.published, 1);
  assert.equal(result.counts.hidden, 1);
  assertIssue(result.issues, "duplicate_public_claim");
  const publicRace = await loadPublicRaceData("california-governor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.deepEqual(publicRace?.race.positions.map((position) => position.id), ["pos-ca-secretary-of-state-california-governor-akinyemi-agbede-1"]);
});

test("bulk review returns diagnostics and writes no overrides for malformed draft JSON", async () => {
  const fixture = await createFixture();
  const draftPath = path.join(fixture.root, "bad-draft.json");
  await fs.writeFile(draftPath, "{ not json", "utf8");

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, false);
  assertIssue(result.issues, "malformed_draft_json");
  assert.equal(await pathExists(path.join(fixture.overridesDir, "races", "california-governor.json")), false);
  assert.equal(await pathExists(path.join(fixture.diagnosticsDir, "bulk-review-latest.json")), true);
});

test("bulk CLI exits non-zero for malformed draft and prints sanitized diagnostics", async () => {
  const fixture = await createFixture();
  const draftPath = path.join(fixture.root, "bad-draft.json");
  await fs.writeFile(draftPath, "{ not json sk-secret-token", "utf8");

  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/review-bulk-positions.ts", "--draft", draftPath, "--reviews-dir", fixture.reviewsDir, "--overrides-dir", fixture.overridesDir, "--public-dir", fixture.publicDir, "--diagnostics-dir", fixture.diagnosticsDir], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /malformed_draft_json/);
  assert.doesNotMatch(result.stdout + result.stderr, /sk-secret-token/);
});

test("bulk CLI accepts explicit validation and publish flags", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => markPublic(draft));
  const validationPath = path.join(fixture.root, "validation", "bulk.json");
  const diagnosticsPath = path.join(fixture.root, "diagnostics", "bulk.json");

  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/review-bulk-positions.ts", "--draft", draftPath, "--reviews-dir", fixture.reviewsDir, "--overrides-dir", fixture.overridesDir, "--public-dir", fixture.publicDir, "--validation", validationPath, "--diagnostics", diagnosticsPath, "--publish"], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(await pathExists(validationPath), true);
  assert.equal(await pathExists(diagnosticsPath), true);
  const validation = JSON.parse(await fs.readFile(validationPath, "utf8"));
  assert.equal(validation.ok, true);
});

test("bulk reports existing override loader failures without overwriting override files", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root, (draft) => markPublic(draft));
  await fs.mkdir(path.join(fixture.overridesDir, "races"), { recursive: true });
  const reviewPath = path.join(fixture.overridesDir, "races", "california-governor.json");
  await fs.writeFile(
    reviewPath,
    `${JSON.stringify({ race: { status: "verified", publicationStatus: "public", positions: [{ id: "bad-existing-position", status: "verified", publicationStatus: "public" }] } }, null, 2)}\n`,
    "utf8",
  );

  const result = await runBulkPositionReview({ draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, diagnosticsDir: fixture.diagnosticsDir, now: fixedNow });

  assert.equal(result.ok, false);
  assertIssue(result.issues, "data_load_error");
  assert.match(result.issues.find((issue) => issue.reasonCode === "data_load_error")?.path ?? "", /manual\/overrides|races\/california-governor\.json/);
  const overrideAfter = JSON.parse(await fs.readFile(reviewPath, "utf8"));
  assert.deepEqual(overrideAfter.race.positions.map((position: { id: string }) => position.id), ["bad-existing-position"]);
});

interface Fixture {
  root: string;
  publicDir: string;
  reviewsDir: string;
  overridesDir: string;
  diagnosticsDir: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-bulk-review-"));
  const publicDir = path.join(root, "data", "public");
  const reviewsDir = path.join(root, "manual", "reviews");
  const overridesDir = path.join(root, "manual", "overrides");
  const diagnosticsDir = path.join(root, "data", "reviewed");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  await clearRacePositions(publicDir, "california-governor");
  return { root, publicDir, reviewsDir, overridesDir, diagnosticsDir };
}

async function writeDraft(root: string, mutate?: (draft: ExtractionDraft) => void): Promise<string> {
  const outDir = path.join(root, "data", "extracted");
  await runExtraction({ outDir, provider: "fixture", raceSlug: "california-governor", now: fixedNow });
  const draftPath = path.join(outDir, "drafts", "latest.json");
  const draft = JSON.parse(await fs.readFile(draftPath, "utf8")) as ExtractionDraft;
  mutate?.(draft);
  await fs.writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  return draftPath;
}

function markPublic(draft: ExtractionDraft): void {
  draft.positions[0].reviewStatus = "verified";
  draft.positions[0].publicationStatus = "public";
  draft.positions[0].publicReady = true;
}

async function clearRacePositions(publicDir: string, raceSlug: string): Promise<void> {
  const racePath = path.join(publicDir, "races", `${raceSlug}.json`);
  const raceFile = JSON.parse(await fs.readFile(racePath, "utf8"));
  raceFile.race.positions = [];
  delete raceFile.race.summary;
  delete raceFile.race.themes;
  await fs.writeFile(racePath, `${JSON.stringify(raceFile, null, 2)}\n`, "utf8");
}

async function readReview(reviewsDir: string): Promise<PositionReviewFile> {
  return JSON.parse(await fs.readFile(path.join(reviewsDir, "races", "california-governor.json"), "utf8")) as PositionReviewFile;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertIssue(issues: { reasonCode: string }[], code: string): void {
  assert.equal(issues.some((issue) => issue.reasonCode === code), true, `Expected issue ${code}; got ${JSON.stringify(issues, null, 2)}`);
}
