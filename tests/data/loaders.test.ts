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

const GOV_SLUG = "california-governor";
const GOV_RACE_ID = "race-california-governor";
const SOS_SOURCE_ID = "src-ca-secretary-of-state";
const FIRST_ENTITY_ID = "ent-california-governor-akinyemi-agbede";
const FIRST_POSITION_ID = "pos-sos-governor-akinyemi-agbede";
const SECOND_POSITION_ID = "pos-sos-governor-mohammad-arif";
const FIRST_EVIDENCE_ID = "ev-sos-governor-akinyemi-agbede";

const EXPECTED_CANONICAL_SLUGS = [
  "board-of-equalization-district-2",
  "california-attorney-general",
  "california-controller",
  "california-governor",
  "california-insurance-commissioner",
  "california-lieutenant-governor",
  "california-secretary-of-state",
  "california-superintendent-public-instruction",
  "california-treasurer",
  "san-francisco-prop-a",
  "san-francisco-prop-b",
  "san-francisco-prop-c",
  "san-francisco-prop-d",
  "sfusd-board-of-education",
  "state-assembly-district-17",
  "state-assembly-district-19",
  "superior-court-judge-seat-16",
  "supervisor-district-2",
  "supervisor-district-4",
  "us-house-district-11",
  "us-house-district-15",
];

test("lists canonical real race slugs deterministically", async () => {
  assert.deepEqual(await listRaceSlugs(), EXPECTED_CANONICAL_SLUGS);
  assert.equal((await listRaceSlugs()).includes("mayor"), false);
});

test("unknown race slug returns null instead of building a broken route", async () => {
  assert.equal(await loadRaceData("missing-race"), null);
  assert.equal(await loadPublicRaceData("missing-race"), null);
});

test("canonical California Governor race loads with S04 public manual override", async () => {
  const loaded = await loadRaceData(GOV_SLUG);

  assert.ok(loaded);
  assert.equal(loaded.race.slug, GOV_SLUG);
  assert.equal(loaded.race.title, "California Governor");
  assert.equal(loaded.race.positions.length, 62);
  assert.equal(loaded.race.positions[0].label, "Official certified candidate listing");
  assert.equal(loaded.checkedFiles.some((file) => file.endsWith("manual/overrides/races/california-governor.json")), true);
});

test("missing override file is allowed", async () => {
  const fixture = await createFixture();
  const loaded = await loadRaceData(GOV_SLUG, { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });

  assert.ok(loaded);
  assert.equal(loaded.race.positions[0].label, "Official certified candidate listing");
});

test("public race loader filters hidden draft, reviewed, and verified-hidden records", async () => {
  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: {
      positions: [
        { id: FIRST_POSITION_ID, status: "verified", publicationStatus: "public" },
        { id: SECOND_POSITION_ID, status: "reviewed", publicationStatus: "public" },
        {
          id: "pos-sos-governor-hidden-fixture",
          raceId: GOV_RACE_ID,
          sourceId: SOS_SOURCE_ID,
          entityId: FIRST_ENTITY_ID,
          kind: "informational",
          status: "verified",
          publicationStatus: "hidden",
          label: "Hidden official-data fixture",
          evidenceIds: ["ev-sos-governor-hidden-fixture"],
          evidence: [{ id: "ev-sos-governor-hidden-fixture", sourceId: SOS_SOURCE_ID, entityId: FIRST_ENTITY_ID, raceId: GOV_RACE_ID, url: "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf", kind: "quote", quote: "Hidden verified fixture evidence must not become public." }],
        },
      ],
      themes: [{ id: "theme-official-list-fixture", label: "Official candidate list coverage", sentiment: "neutral", evidenceIds: [FIRST_EVIDENCE_ID, "ev-sos-governor-hidden-fixture"] }],
      summary: { id: "sum-official-list-fixture", status: "verified", publicationStatus: "public", text: "Fixture summary", evidenceIds: [FIRST_EVIDENCE_ID, "ev-sos-governor-hidden-fixture"] },
    },
  });

  const loaded = await loadPublicRaceData(GOV_SLUG, { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });

  assert.ok(loaded);
  assert.equal(loaded.race.status, "verified");
  assert.equal(loaded.race.publicationStatus, "public");
  assert.equal(loaded.race.positions.some((position) => position.id === SECOND_POSITION_ID), false);
  assert.equal(loaded.race.positions.some((position) => position.id === "pos-sos-governor-hidden-fixture"), false);
  assert.equal(loaded.race.positions.some((position) => position.id === FIRST_POSITION_ID), true);
  assert.deepEqual(loaded.race.themes?.[0]?.evidenceIds, [FIRST_EVIDENCE_ID]);
  assert.deepEqual(loaded.race.summary?.evidenceIds, [FIRST_EVIDENCE_ID]);
});

test("public race loader returns null for non-public race status", async () => {
  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, { race: { status: "draft", publicationStatus: "hidden" } });
  const loaded = await loadPublicRaceData(GOV_SLUG, { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.equal(loaded, null);
});

test("public race context returns only referenced source and entity records", async () => {
  const loaded = await loadPublicRaceContext(GOV_SLUG);
  assert.ok(loaded);
  assert.deepEqual(loaded.sources.map((source) => source.id), [SOS_SOURCE_ID, "src-sf-chronicle", "src-growsf"]);
  assert.equal(loaded.entities.length, 61);
  assert.equal(loaded.entities[0].id, FIRST_ENTITY_ID);
  assert.equal(loaded.checkedFiles.some((file) => file.endsWith("manual/overrides/races/california-governor.json")), true);
});

test("malformed override JSON includes manual override path and phase", async () => {
  const fixture = await createFixture();
  await fs.mkdir(path.join(fixture.overridesDir, "races"), { recursive: true });
  await fs.writeFile(path.join(fixture.overridesDir, "races", `${GOV_SLUG}.json`), "{ not json", "utf8");

  await assert.rejects(
    () => loadRaceData(GOV_SLUG, { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }),
    (error: unknown) => {
      assert.ok(error instanceof DataLoadError);
      assert.equal(error.phase, "override");
      assert.match(error.message, /manual\/overrides|overrides\/races\/california-governor\.json/);
      return true;
    },
  );
});

test("invalid merged override references surface validation context", async () => {
  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, { race: { positions: [{ id: FIRST_POSITION_ID, sourceId: "src-missing" }] } });

  await assert.rejects(
    () => loadRaceData(GOV_SLUG, { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }),
    (error: unknown) => {
      assert.ok(error instanceof DataLoadError);
      assert.equal(error.phase, "merged");
      assert.equal(error.slug, GOV_SLUG);
      assert.ok(error.issues.some((issue) => issue.code === "missing_reference" && issue.path.includes("sourceId")));
      return true;
    },
  );
});

test("duplicate records introduced inside one override are rejected", () => {
  assert.throws(
    () => mergeRace(baseRace(), { positions: [{ id: "pos-new" }, { id: "pos-new" }] as never }, GOV_SLUG, "manual/overrides/races/california-governor.json"),
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
  await fs.writeFile(path.join(overridesDir, "races", `${GOV_SLUG}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function baseRace(): Race {
  return {
    id: GOV_RACE_ID,
    slug: GOV_SLUG,
    title: "California Governor",
    kind: "statewide-executive",
    status: "verified",
    publicationStatus: "public",
    electionDate: "2026-06-02",
    jurisdiction: "California",
    entityIds: [FIRST_ENTITY_ID],
    sourceIds: [SOS_SOURCE_ID],
    positions: [],
  };
}
