import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRacePageModel, generateStaticParams } from "../../app/races/[slug]/page";

const GSD_PATH = /(^|\/)\.gsd(\/|$)/;

test("public race route statically generates public race slugs only", async () => {
  assert.deepEqual(await generateStaticParams(), [{ slug: "mayor" }]);
});

test("public race page model exposes mayor route content and placeholders", async () => {
  const model = await buildRacePageModel("mayor");

  assert.ok(model);
  assert.equal(model.ui.race.slug, "mayor");
  assert.equal(model.ui.race.title, "San Francisco Mayor");
  assert.equal(model.ui.race.electionDate, "2026-06-02");
  assert.equal(model.ui.race.jurisdiction, "San Francisco");
  assert.equal(model.diagnostics.reviewStatus, "verified");
  assert.equal(model.diagnostics.publicationStatus, "public");
  assert.equal(model.diagnostics.hasManualOverride, true);
  assert.equal(model.diagnostics.publicSourceCount, 2);
  assert.equal(model.diagnostics.publicPositionCount, 2);
  assert.equal(model.diagnostics.evidenceCount, 2);
  assert.equal(model.ui.consensus.entityName, "Sample Candidate A");
  assert.equal(model.ui.consensus.percentage, 50);
  assert.deepEqual(
    model.ui.sourceTypeBreakdown.map((item) => item.sourceType),
    ["civic voter guide / recommendations", "editorial endorsements"],
  );
  assert.equal(model.ui.placeholders.matrixReady, true);
  assert.equal(model.ui.placeholders.receiptsReady, true);
  assert.equal(model.ui.placeholders.aiDisclosureReady, true);
  assert.equal(model.ui.placeholders.drilldownReady, true);
});

test("public race page model returns null for unknown or non-public slugs", async () => {
  assert.equal(await buildRacePageModel("missing-race"), null);

  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: {
      status: "draft",
      publicationStatus: "hidden",
    },
  });

  assert.equal(await buildRacePageModel("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

test("public race route checked files do not leak gsd paths", async () => {
  const model = await buildRacePageModel("mayor");

  assert.ok(model);
  assert.ok(model.checkedFiles.length > 0);
  assert.equal(model.checkedFiles.some((file) => GSD_PATH.test(file)), false);
});

test("public race page model uses safe zero consensus copy for zero-position fixtures", async () => {
  const fixture = await createFixture();
  await writeCanonicalRace(fixture.publicDir, {
    status: "verified",
    publicationStatus: "public",
    positions: [],
    sourceIds: [],
    entityIds: [],
    themes: undefined,
    summary: undefined,
  });

  const model = await buildRacePageModel("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });

  assert.ok(model);
  assert.equal(model.ui.sourceCount, 0);
  assert.equal(model.ui.evidenceCount, 0);
  assert.equal(model.ui.consensus.label, "No public sources");
  assert.equal(model.ui.consensus.percentage, 0);
  assert.equal(model.ui.placeholders.hasPublicPositions, false);
  assert.equal(model.ui.placeholders.matrixReady, false);
  assert.equal(model.ui.placeholders.receiptsReady, false);
});

async function createFixture(): Promise<{ publicDir: string; overridesDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-race-route-"));
  const publicDir = path.join(root, "data", "public");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  return { publicDir, overridesDir };
}

async function writeOverride(overridesDir: string, value: unknown): Promise<void> {
  await fs.mkdir(path.join(overridesDir, "races"), { recursive: true });
  await fs.writeFile(path.join(overridesDir, "races", "mayor.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCanonicalRace(publicDir: string, raceOverrides: Record<string, unknown>): Promise<void> {
  const filePath = path.join(publicDir, "races", "mayor.json");
  const json = JSON.parse(await fs.readFile(filePath, "utf8")) as { race: Record<string, unknown> };
  json.race = { ...json.race, ...raceOverrides };
  for (const [key, value] of Object.entries(json.race)) {
    if (value === undefined) delete json.race[key];
  }
  await fs.writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}
