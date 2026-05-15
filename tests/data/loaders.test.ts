import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DataLoadError,
  listRaceSlugs,
  loadPublicRaceContext,
  loadPublicRaceData,
  loadRaceData,
  mergeRace,
} from "../../lib/data/loaders";
import type { Race } from "../../lib/data/types";

test("lists canonical race slugs deterministically", async () => {
  assert.deepEqual(await listRaceSlugs(), ["mayor"]);
});

test("unknown race slug returns null instead of building a broken route", async () => {
  assert.equal(await loadRaceData("missing-race"), null);
  assert.equal(await loadPublicRaceData("missing-race"), null);
});

test("applies committed manual race override after canonical data", async () => {
  const loaded = await loadRaceData("mayor");

  assert.ok(loaded);
  assert.equal(loaded.race.positions[0].label, "Sample display label override for Candidate A");
  assert.match(loaded.race.summary?.text ?? "", /manual review override/);
  assert.ok(loaded.checkedFiles.some((file) => file.endsWith("manual/overrides/races/mayor.json")));
});

test("missing override file is allowed", async () => {
  const fixture = await createFixture();
  const loaded = await loadRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });

  assert.ok(loaded);
  assert.equal(loaded.race.positions[0].label, "Sample endorsement for Candidate A");
});

test("public race loader filters hidden draft, reviewed, and verified-hidden records", async () => {
  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: {
      status: "verified",
      publicationStatus: "public",
      positions: [
        {
          id: "pos-chronicle-candidate-a",
          status: "verified",
          publicationStatus: "public",
        },
        {
          id: "pos-growsf-candidate-b",
          status: "reviewed",
          publicationStatus: "public",
        },
        {
          id: "pos-hidden-verified-candidate-b",
          raceId: "race-mayor",
          sourceId: "src-growsf",
          entityId: "ent-sample-candidate-b",
          kind: "endorse",
          status: "verified",
          publicationStatus: "hidden",
          label: "Hidden verified generated draft",
          evidenceIds: ["ev-hidden-verified-candidate-b"],
          evidence: [
            {
              id: "ev-hidden-verified-candidate-b",
              sourceId: "src-growsf",
              entityId: "ent-sample-candidate-b",
              raceId: "race-mayor",
              url: "https://growsf.org/voter-guide/sample-2026/mayor",
              kind: "quote",
              quote: "Hidden verified fixture evidence must not become public.",
            },
          ],
        },
      ],
      themes: [
        {
          id: "theme-sample-housing",
          evidenceIds: ["ev-chronicle-candidate-a", "ev-growsf-candidate-b", "ev-hidden-verified-candidate-b"],
        },
      ],
      summary: {
        status: "verified",
        publicationStatus: "public",
        evidenceIds: ["ev-chronicle-candidate-a", "ev-growsf-candidate-b", "ev-hidden-verified-candidate-b"],
      },
    },
  });

  const loaded = await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });

  assert.ok(loaded);
  assert.equal(loaded.race.status, "verified");
  assert.equal(loaded.race.publicationStatus, "public");
  assert.deepEqual(loaded.race.positions.map((position) => position.id), ["pos-chronicle-candidate-a"]);
  assert.deepEqual(loaded.race.themes?.[0]?.evidenceIds, ["ev-chronicle-candidate-a"]);
  assert.deepEqual(loaded.race.summary?.evidenceIds, ["ev-chronicle-candidate-a"]);
});

test("public race loader returns null for non-public race status", async () => {
  const fixture = await createFixture();
  const loaded = await loadPublicRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });

  assert.equal(loaded, null);
});

test("public race context returns only referenced source and entity records", async () => {
  const loaded = await loadPublicRaceContext("mayor");

  assert.ok(loaded);
  assert.deepEqual(loaded.sources.map((source) => source.id).sort(), ["src-growsf", "src-sf-chronicle"]);
  assert.deepEqual(loaded.entities.map((entity) => entity.id).sort(), ["ent-sample-candidate-a", "ent-sample-candidate-b"]);
  assert.ok(loaded.checkedFiles.some((file) => file.endsWith("manual/overrides/races/mayor.json")));
});

test("malformed override JSON includes manual override path and phase", async () => {
  const fixture = await createFixture();
  await fs.mkdir(path.join(fixture.overridesDir, "races"), { recursive: true });
  await fs.writeFile(path.join(fixture.overridesDir, "races", "mayor.json"), "{ not json", "utf8");

  await assert.rejects(
    () => loadRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }),
    (error: unknown) => {
      assert.ok(error instanceof DataLoadError);
      assert.equal(error.phase, "override");
      assert.match(error.message, /manual\/overrides|overrides\/races\/mayor\.json/);
      return true;
    },
  );
});

test("invalid merged override references surface validation context", async () => {
  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: {
      positions: [
        {
          id: "pos-chronicle-candidate-a",
          sourceId: "src-missing",
        },
      ],
    },
  });

  await assert.rejects(
    () => loadRaceData("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }),
    (error: unknown) => {
      assert.ok(error instanceof DataLoadError);
      assert.equal(error.phase, "merged");
      assert.equal(error.slug, "mayor");
      assert.ok(error.issues.some((issue) => issue.code === "missing_reference" && issue.path.includes("sourceId")));
      return true;
    },
  );
});

test("duplicate records introduced inside one override are rejected", () => {
  assert.throws(
    () => mergeRace(baseRace(), { positions: [{ id: "pos-new" }, { id: "pos-new" }] as never }, "mayor", "manual/overrides/races/mayor.json"),
    (error: unknown) => {
      assert.ok(error instanceof DataLoadError);
      assert.equal(error.phase, "override");
      assert.match(error.message, /Duplicate override record 'pos-new'/);
      return true;
    },
  );
});

async function createFixture(): Promise<{ publicDir: string; overridesDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-loaders-"));
  const publicDir = path.join(root, "data", "public");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  return { publicDir, overridesDir };
}

async function writeOverride(overridesDir: string, value: unknown): Promise<void> {
  await fs.mkdir(path.join(overridesDir, "races"), { recursive: true });
  await fs.writeFile(path.join(overridesDir, "races", "mayor.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function baseRace(): Race {
  return {
    id: "race-mayor",
    slug: "mayor",
    title: "San Francisco Mayor",
    kind: "local-executive",
    status: "draft",
    publicationStatus: "hidden",
    electionDate: "2026-06-02",
    jurisdiction: "San Francisco",
    entityIds: ["ent-sample-candidate-a"],
    sourceIds: ["src-sf-chronicle"],
    positions: [],
  };
}
