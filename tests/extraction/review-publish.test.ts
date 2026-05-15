import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPublicRaceData } from "../../lib/data/loaders";
import { runExtraction } from "../../lib/extraction/run";
import { preparePositionReview, publishPositionReview, statusPositionReview, type PositionReviewFile } from "../../lib/review/positions";

const fixedNow = () => new Date("2026-05-15T12:30:00.000Z");

test("prepare creates hidden editable race review records from extraction drafts", async () => {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root);

  const result = await preparePositionReview({ raceSlug: "mayor", draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, now: fixedNow });

  assert.equal(result.ok, true);
  assert.equal(result.counts.positions, 2);
  assert.equal(result.counts.hidden, 2);
  const review = await readReview(fixture.reviewsDir);
  assert.equal(review.positions.every((position) => position.status === "draft" && position.publicationStatus === "hidden"), true);
  assert.equal(await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

test("publish copies only verified public review records and keeps rejected drafts hidden", async () => {
  const fixture = await createPreparedFixture();
  const review = await readReview(fixture.reviewsDir);
  review.positions[0].status = "verified";
  review.positions[0].publicationStatus = "public";
  review.positions[1].status = "rejected";
  review.positions[1].publicationStatus = "hidden";
  await writeReview(fixture.reviewsDir, review);

  const result = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, now: fixedNow });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.publicPositionIds, [review.positions[0].id]);
  const publicRace = await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.ok(publicRace);
  assert.deepEqual(publicRace.race.positions.map((position) => position.id), [review.positions[0].id]);
  assert.equal(publicRace.race.positions[0].evidence[0].quote, review.positions[0].evidence[0].quote);
});

test("reviewed hidden records are not public after publish", async () => {
  const fixture = await createPreparedFixture();
  const review = await readReview(fixture.reviewsDir);
  review.positions[0].status = "reviewed";
  review.positions[0].publicationStatus = "hidden";
  review.positions[1].status = "rejected";
  review.positions[1].publicationStatus = "hidden";
  await writeReview(fixture.reviewsDir, review);

  const result = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

test("publish rejects unreviewed, rejected, or evidence-less public positions", async () => {
  const fixture = await createPreparedFixture();
  const review = await readReview(fixture.reviewsDir);
  review.positions[0].status = "draft";
  review.positions[0].publicationStatus = "public";
  review.positions[1].status = "verified";
  review.positions[1].publicationStatus = "public";
  review.positions[1].evidence = [];
  review.positions[1].evidenceIds = [];
  await writeReview(fixture.reviewsDir, review);

  const result = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir });

  assert.equal(result.ok, false);
  assertIssue(result.issues, "unreviewed_public_position");
  assertIssue(result.issues, "missing_publish_evidence");
});

test("duplicate review IDs fail status before publish", async () => {
  const fixture = await createPreparedFixture();
  const review = await readReview(fixture.reviewsDir);
  review.positions[1].id = review.positions[0].id;
  await writeReview(fixture.reviewsDir, review);

  const result = await statusPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir });

  assert.equal(result.ok, false);
  assertIssue(result.issues, "duplicate_review_id");
});

test("malformed review JSON fails in the review phase", async () => {
  const fixture = await createFixture();
  await fs.mkdir(path.join(fixture.reviewsDir, "races"), { recursive: true });
  await fs.writeFile(path.join(fixture.reviewsDir, "races", "mayor.json"), "{ not json", "utf8");

  const result = await statusPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir });

  assert.equal(result.ok, false);
  assert.equal(result.phase, "review");
  assertIssue(result.issues, "malformed_review_json");
});

test("missing draft file produces a clear prepare error", async () => {
  const fixture = await createFixture();
  const missingDraft = path.join(fixture.root, "missing-draft.json");

  const result = await preparePositionReview({ raceSlug: "mayor", draftPath: missingDraft, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir });

  assert.equal(result.ok, false);
  assertIssue(result.issues, "missing_draft_file");
  assert.match(result.issues[0].path, /missing-draft\.json/);
});

test("publish preserves existing override fields not owned by extraction", async () => {
  const fixture = await createPreparedFixture();
  await fs.mkdir(path.join(fixture.overridesDir, "races"), { recursive: true });
  await fs.writeFile(
    path.join(fixture.overridesDir, "races", "mayor.json"),
    `${JSON.stringify({ race: { summary: { text: "Preserved local summary" }, positions: [{ id: "pos-chronicle-candidate-a", label: "Preserved label" }] } }, null, 2)}\n`,
    "utf8",
  );
  const review = await readReview(fixture.reviewsDir);
  review.positions[0].status = "verified";
  review.positions[0].publicationStatus = "public";
  await writeReview(fixture.reviewsDir, review);

  const result = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  const override = JSON.parse(await fs.readFile(path.join(fixture.overridesDir, "races", "mayor.json"), "utf8"));
  assert.equal(override.race.summary.text, "Preserved local summary");
  assert.equal(override.race.positions.some((position: { id: string; label?: string }) => position.id === "pos-chronicle-candidate-a" && position.label === "Preserved label"), true);
  assert.equal(override.race.positions.some((position: { id: string }) => position.id === review.positions[0].id), true);
});

async function createPreparedFixture(): Promise<Fixture> {
  const fixture = await createFixture();
  const draftPath = await writeDraft(fixture.root);
  const result = await preparePositionReview({ raceSlug: "mayor", draftPath, reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, now: fixedNow });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  return fixture;
}

interface Fixture {
  root: string;
  publicDir: string;
  reviewsDir: string;
  overridesDir: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-review-"));
  const publicDir = path.join(root, "data", "public");
  const reviewsDir = path.join(root, "manual", "reviews");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  return { root, publicDir, reviewsDir, overridesDir };
}

async function writeDraft(root: string): Promise<string> {
  const outDir = path.join(root, "data", "extracted");
  await runExtraction({ outDir, provider: "fixture", raceSlug: "mayor", now: fixedNow });
  return path.join(outDir, "drafts", "latest.json");
}

async function readReview(reviewsDir: string): Promise<PositionReviewFile> {
  return JSON.parse(await fs.readFile(path.join(reviewsDir, "races", "mayor.json"), "utf8")) as PositionReviewFile;
}

async function writeReview(reviewsDir: string, review: PositionReviewFile): Promise<void> {
  await fs.writeFile(path.join(reviewsDir, "races", "mayor.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
}

function assertIssue(issues: { code: string }[], code: string): void {
  assert.equal(issues.some((issue) => issue.code === code), true, `Expected issue ${code}; got ${JSON.stringify(issues, null, 2)}`);
}
