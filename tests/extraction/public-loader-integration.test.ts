import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataLoadError, loadPublicRaceData, loadRaceData } from "../../lib/data/loaders";
import { runExtraction } from "../../lib/extraction/run";
import { preparePositionReview, publishPositionReview, type PositionReviewFile } from "../../lib/review/positions";

const fixedNow = () => new Date("2026-05-15T12:30:00.000Z");

test("reviewed extraction outputs become public only after verified publication through manual overrides", async () => {
  const fixture = await createPreparedFixture();
  const review = await readReview(fixture.reviewsDir);
  review.positions[0] = {
    ...review.positions[0],
    status: "verified",
    publicationStatus: "public",
    label: "Reviewed extraction override for Candidate A",
    rationale: "Human-reviewed extraction rationale wins over canonical fixture text.",
  };
  review.positions[1] = {
    ...review.positions[1],
    status: "reviewed",
    publicationStatus: "public",
    label: "Reviewed but not verified should stay private",
  };
  await writeReview(fixture.reviewsDir, review);

  const publish = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, now: fixedNow });

  assert.equal(publish.ok, false, "reviewed public records must not publish without verification");
  assert.equal(await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);

  review.positions[1].publicationStatus = "hidden";
  await writeReview(fixture.reviewsDir, review);
  const republish = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, now: fixedNow });
  assert.equal(republish.ok, true, JSON.stringify(republish.issues, null, 2));

  const allRace = await loadRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.ok(allRace);
  assert.equal(allRace.race.positions.some((position) => position.id === review.positions[1].id), false, "hidden reviewed extraction records are not copied into public overrides");

  const publicRace = await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.ok(publicRace);
  assert.deepEqual(publicRace.race.positions.map((position) => position.id), [review.positions[0].id]);
  assert.equal(publicRace.race.positions[0].label, "Reviewed extraction override for Candidate A");
  assert.equal(publicRace.race.positions[0].rationale, "Human-reviewed extraction rationale wins over canonical fixture text.");
  assert.equal(publicRace.race.positions[0].evidence[0].artifactId, review.positions[0].evidence[0].artifactId);
  assert.equal(publicRace.race.positions[0].evidence[0].chunkId, review.positions[0].evidence[0].chunkId);
  assert.equal(await loadPublicRaceData("missing-race", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

test("public loader rejects published extraction evidence missing required chunk provenance", async () => {
  const fixture = await createPreparedFixture();
  const review = await readReview(fixture.reviewsDir);
  review.positions[0].status = "verified";
  review.positions[0].publicationStatus = "public";
  await writeReview(fixture.reviewsDir, review);

  const publish = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, now: fixedNow });
  assert.equal(publish.ok, true, JSON.stringify(publish.issues, null, 2));

  const overridePath = path.join(fixture.overridesDir, "races", "mayor.json");
  const override = JSON.parse(await fs.readFile(overridePath, "utf8"));
  delete override.race.positions[0].evidence[0].chunkId;
  await fs.writeFile(overridePath, `${JSON.stringify(override, null, 2)}\n`, "utf8");

  await assert.rejects(
    () => loadRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }),
    (error: unknown) => {
      assert.ok(error instanceof DataLoadError);
      assert.equal(error.phase, "merged");
      assert.ok(error.issues.some((issue) => issue.code === "missing_provenance" && issue.path.includes("chunkId")));
      return true;
    },
  );
});

interface Fixture {
  root: string;
  publicDir: string;
  reviewsDir: string;
  overridesDir: string;
}

async function createPreparedFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-public-loader-"));
  const publicDir = path.join(root, "data", "public");
  const reviewsDir = path.join(root, "manual", "reviews");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  const outDir = path.join(root, "data", "extracted");
  await runExtraction({ outDir, provider: "fixture", raceSlug: "mayor", now: fixedNow });
  const prepared = await preparePositionReview({ raceSlug: "mayor", draftPath: path.join(outDir, "drafts", "latest.json"), reviewsDir, overridesDir, publicDir, now: fixedNow });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.issues, null, 2));
  return { root, publicDir, reviewsDir, overridesDir };
}

async function readReview(reviewsDir: string): Promise<PositionReviewFile> {
  return JSON.parse(await fs.readFile(path.join(reviewsDir, "races", "mayor.json"), "utf8")) as PositionReviewFile;
}

async function writeReview(reviewsDir: string, review: PositionReviewFile): Promise<void> {
  await fs.writeFile(path.join(reviewsDir, "races", "mayor.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
}
