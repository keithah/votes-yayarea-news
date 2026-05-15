import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadPublicRaceContext } from "../../lib/data/loaders";
import { validatePublicDataFiles } from "../../lib/data/validate";

const REQUIRED_TRACKED_SLUGS = [
  "california-governor",
  "california-lieutenant-governor",
  "california-secretary-of-state",
  "california-controller",
  "california-treasurer",
  "california-attorney-general",
  "california-insurance-commissioner",
  "california-superintendent-public-instruction",
  "board-of-equalization-district-2",
  "us-house-district-11",
  "us-house-district-15",
  "supervisor-district-2",
  "supervisor-district-4",
  "sfusd-board-of-education",
  "superior-court-judge-seat-16",
  "state-assembly-district-17",
  "state-assembly-district-19",
  "san-francisco-prop-a",
  "san-francisco-prop-b",
  "san-francisco-prop-c",
  "san-francisco-prop-d",
];

const MD_LISTED_SOURCE_NAMES = [
  "San Francisco Chronicle Editorial Board",
  "Mission Local",
  "San Francisco Standard",
  "League of Women Voters of San Francisco / Voter's Edge",
  "SPUR Voter Guide",
  "GrowSF Voter Guide",
  "San Francisco Democratic Party",
  "San Francisco Republican Party",
  "Harvey Milk LGBTQ Democratic Club",
  "Alice B. Toklas LGBTQ Democratic Club",
  "San Francisco Berniecrats",
  "United Democratic Club",
  "San Francisco Labor Council",
  "SEIU Local 1021",
  "United Educators of San Francisco",
  "YIMBY Action / SF YIMBY",
  "SF Tenants Union",
  "Housing Action Coalition",
  "Sierra Club Bay Chapter",
  "San Francisco Bicycle Coalition",
  "TogetherSF Action",
  "ACLU of Northern California",
];

interface BallotUniverseManifest {
  trackedRaces: Array<{
    slug: string;
    publicationStatus: "hidden" | "public" | "archived";
    officialDataStatus: string;
    officialDataNotes: string;
    entityCount: number;
  }>;
  sourceRegistry: {
    mdListedSourceIds: string[];
  };
}

test("canonical public data validates after sample replacement", async () => {
  const result = await validatePublicDataFiles();
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.races, REQUIRED_TRACKED_SLUGS.length);
  assert.equal(result.counts.sources >= MD_LISTED_SOURCE_NAMES.length, true);
  assert.equal(result.counts.entities > 0, true);
});

test("ballot-universe manifest documents every tracked slug or official-data gap", async () => {
  const manifest = await readJson<BallotUniverseManifest>("data/public/ballot-universe.json");
  const bySlug = new Map(manifest.trackedRaces.map((race) => [race.slug, race]));

  for (const slug of REQUIRED_TRACKED_SLUGS) {
    const race = bySlug.get(slug);
    assert.ok(race, `missing manifest row for ${slug}`);
    assert.match(race.officialDataStatus, /^official-(candidate-list-imported|data-gap)$/);
    assert.ok(race.officialDataNotes.length > 24, `missing official-data notes for ${slug}`);
    if (race.officialDataStatus === "official-data-gap") {
      assert.equal(race.publicationStatus, "hidden", `${slug} must stay hidden while official data is unavailable`);
      assert.equal(race.entityCount, 0, `${slug} must not invent entities while official data is unavailable`);
    }
  }
});

test("California Governor is a public real contest with official candidate entities", async () => {
  const context = await loadPublicRaceContext("california-governor");
  assert.ok(context, "expected /races/california-governor/ to have a public context");
  assert.equal(context.race.slug, "california-governor");
  assert.equal(context.race.publicationStatus, "public");
  assert.equal(context.race.status, "verified");
  assert.equal(context.entities.length, 61);

  const names = new Set(context.entities.map((entity) => entity.name));
  for (const expected of ["Xavier Becerra", "Katie Porter", "Tom Steyer", "Steve Hilton", "Betty T. Yee"]) {
    assert.ok(names.has(expected), `missing expected official Governor candidate ${expected}`);
  }

  for (const entity of context.entities) {
    assert.equal(entity.kind, "candidate");
    assert.equal(entity.status, "verified");
    assert.match(entity.description ?? "", /California Secretary of State/);
  }
});

test("original MD-listed source universe is represented without fixture URLs", async () => {
  const sourcesFile = await readJson<{ sources: Array<{ name: string; notes?: string; sampleFixture?: boolean; guideUrl?: string }> }>(
    "data/public/sources.json",
  );
  const names = new Set(sourcesFile.sources.map((source) => source.name));
  for (const name of MD_LISTED_SOURCE_NAMES) assert.ok(names.has(name), `missing source ${name}`);

  for (const source of sourcesFile.sources) {
    assert.equal(source.sampleFixture, undefined, `${source.name} still has sampleFixture`);
    assert.doesNotMatch(source.guideUrl ?? "", /sample-2026|sample-voter-guide/);
  }
});

test("canonical public files contain no legacy Mayor launch fixture leakage", async () => {
  await assert.rejects(() => fs.stat("data/public/races/mayor.json"), /ENOENT/);

  const canonicalText = await readPublicDataText();
  for (const forbidden of [
    "Sample Candidate A",
    "Sample Candidate B",
    "sampleFixture",
    "sample-2026",
    "sample-voter-guide",
    "race-mayor",
  ]) {
    assert.equal(canonicalText.includes(forbidden), false, `forbidden fixture text leaked: ${forbidden}`);
  }

  const collections = await readJson<{ collections: Array<{ raceIds: string[] }> }>("data/public/collections.json");
  assert.equal(collections.collections.some((collection) => collection.raceIds.includes("race-mayor")), false);
});

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readPublicDataText(): Promise<string> {
  const root = path.join(process.cwd(), "data", "public");
  const files: string[] = [];
  await collectJsonFiles(root, files);
  return (await Promise.all(files.sort().map((file) => fs.readFile(file, "utf8")))).join("\n");
}

async function collectJsonFiles(dir: string, files: string[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectJsonFiles(fullPath, files);
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(fullPath);
  }
}
