import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPublicRaceData } from "../../lib/data/loaders";
import { runExtraction } from "../../lib/extraction/run";
import { preparePositionReview, publishPositionReview, type PositionReviewFile } from "../../lib/review/positions";

const fixedNow = () => new Date("2026-05-15T12:45:00.000Z");

test("S04 generated artifacts are present and coherent after verifier publication", async () => {
  const bundle = await readArtifactBundle(process.cwd());

  assert.equal(bundle.run.status, "complete");
  assert.equal(bundle.run.provider?.provider, "fixture");
  assert.equal(bundle.run.provider?.model, "fixture-v1");
  assert.equal(bundle.run.outputPath, "data/extracted/drafts/latest.json");
  assert.equal(bundle.run.validationPath, "data/extracted/validation/latest.json");
  assert.equal(bundle.run.counts.positions, bundle.draft.positions.length);
  assert.equal(bundle.run.counts.evidence, bundle.draft.evidence.length);
  assert.equal(bundle.run.counts.errors, 0);
  assert.equal(bundle.validation.ok, true);
  assert.equal(bundle.validation.counts.errors, 0);
  assert.equal(bundle.validation.counts.positions, bundle.draft.positions.length);
  assert.equal(bundle.validation.counts.evidence, bundle.draft.evidence.length);
  assert.equal(bundle.review.status, "published");
  assert.equal(bundle.review.positions.length, bundle.draft.positions.length);
  assert.equal(bundle.review.positions.every((position) => position.status === "verified" && position.publicationStatus === "public"), true);

  const overridePositions = bundle.override.race?.positions ?? [];
  for (const position of bundle.review.positions) {
    assert.equal(overridePositions.some((candidate: { id?: string }) => candidate.id === position.id), true, `Expected override to include ${position.id}`);
  }
});

test("artifact assertion fails on a failed extraction run status", async () => {
  const root = await copyArtifactBundle();
  const runPath = path.join(root, "data", "extracted", "runs", "latest.json");
  const run = JSON.parse(await fs.readFile(runPath, "utf8"));
  run.status = "failed";
  await writeJson(runPath, run);

  await assert.rejects(() => assertS04Artifacts(root), /status=complete/);
});

test("artifact assertion fails on validation reports with errors", async () => {
  const root = await copyArtifactBundle();
  const validationPath = path.join(root, "data", "extracted", "validation", "latest.json");
  const validation = JSON.parse(await fs.readFile(validationPath, "utf8"));
  validation.ok = false;
  validation.counts.errors = 1;
  validation.issues = [{ code: "test_error", severity: "error", path: "draft", message: "Synthetic failure" }];
  await writeJson(validationPath, validation);

  await assert.rejects(() => assertS04Artifacts(root), /validation ok=true/);
});

test("artifact assertion fails when the review file is missing", async () => {
  const root = await copyArtifactBundle();
  await fs.rm(path.join(root, "manual", "reviews", "races", "mayor.json"));

  await assert.rejects(() => assertS04Artifacts(root), /manual\/reviews\/races\/mayor\.json/);
});

test("artifact assertion fails when the override file is missing", async () => {
  const root = await copyArtifactBundle();
  await fs.rm(path.join(root, "manual", "overrides", "races", "mayor.json"));

  await assert.rejects(() => assertS04Artifacts(root), /manual\/overrides\/races\/mayor\.json/);
});

test("publish can succeed while public loader returns no records when all reviewed records stay hidden", async () => {
  const fixture = await createPreparedFixture();
  const review = await readReview(fixture.reviewsDir);
  for (const position of review.positions) {
    position.status = "rejected";
    position.publicationStatus = "hidden";
  }
  await writeReview(fixture.reviewsDir, review);

  const publish = await publishPositionReview({ raceSlug: "mayor", reviewsDir: fixture.reviewsDir, overridesDir: fixture.overridesDir, publicDir: fixture.publicDir, now: fixedNow });

  assert.equal(publish.ok, true, JSON.stringify(publish.issues, null, 2));
  assert.equal(await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

async function assertS04Artifacts(root: string): Promise<void> {
  const bundle = await readArtifactBundle(root);
  if (bundle.run.status !== "complete") throw new Error(`Expected data/extracted/runs/latest.json status=complete, got ${bundle.run.status}`);
  if (bundle.run.provider?.provider !== "fixture") throw new Error(`Expected data/extracted/runs/latest.json provider=fixture, got ${bundle.run.provider?.provider}`);
  if (!bundle.validation.ok || bundle.validation.counts?.errors !== 0) throw new Error("Expected data/extracted/validation/latest.json validation ok=true with counts.errors=0");
  if (!Array.isArray(bundle.review.positions) || bundle.review.positions.length === 0) throw new Error("Expected manual/reviews/races/mayor.json to contain positions");
  const overridePositions = bundle.override.race?.positions ?? [];
  if (!Array.isArray(overridePositions) || overridePositions.length === 0) throw new Error("Expected manual/overrides/races/mayor.json to contain public positions");
}

async function readArtifactBundle(root: string): Promise<{ run: any; validation: any; draft: any; review: PositionReviewFile; override: any }> {
  return {
    run: await readRequiredJson(root, "data/extracted/runs/latest.json"),
    validation: await readRequiredJson(root, "data/extracted/validation/latest.json"),
    draft: await readRequiredJson(root, "data/extracted/drafts/latest.json"),
    review: await readRequiredJson(root, "manual/reviews/races/mayor.json") as PositionReviewFile,
    override: await readRequiredJson(root, "manual/overrides/races/mayor.json"),
  };
}

async function readRequiredJson(root: string, relativePath: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf8"));
  } catch (error) {
    throw new Error(`Missing or unreadable required S04 artifact ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function copyArtifactBundle(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-s04-artifacts-"));
  for (const relativePath of [
    "data/extracted/runs/latest.json",
    "data/extracted/validation/latest.json",
    "data/extracted/drafts/latest.json",
    "manual/reviews/races/mayor.json",
    "manual/overrides/races/mayor.json",
  ]) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.copyFile(path.join(process.cwd(), relativePath), path.join(root, relativePath));
  }
  return root;
}

interface Fixture {
  root: string;
  publicDir: string;
  reviewsDir: string;
  overridesDir: string;
}

async function createPreparedFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-s04-hidden-publish-"));
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
  await writeJson(path.join(reviewsDir, "races", "mayor.json"), review);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
