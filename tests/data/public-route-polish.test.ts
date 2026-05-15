import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { generateMetadata as generateEntityMetadata } from "../../app/entities/[slug]/page";
import { generateMetadata as generateHomeMetadata } from "../../app/page";
import { buildRacePageModel, generateMetadata as generateRaceMetadata, generateStaticParams as generateRaceStaticParams } from "../../app/races/[slug]/page";
import { generateMetadata as generateSourceMetadata } from "../../app/sources/[slug]/page";
import { metadata as aiDisclosureMetadata } from "../../app/how-we-use-ai/page";
import { buildShareMetadata, SITE_ORIGIN } from "../../lib/share/metadata";

const PRIVATE_PATH_PATTERN = /(?:\.gsd|manual\/(?:reviews|overrides)\/|data\/(?:public|extracted|ingested)\/|\/home\/|file:|tmp\/)/i;
const SAMPLE_OR_REMOVED_SLUG_PATTERN = /(?:^|-)sample(?:-|$)|(?:^|-)mayor(?:-|$)/i;
const DIAGNOSTIC_HEADING_PATTERN = /(?:Visible diagnostics|What reached the static|Checked public data files|Public data inspected|checked-file disclosure)/i;
const DRILLDOWN_IMPLEMENTATION_COPY_PATTERN = /(?:Source drill-down|Entity drill-down|Source URL)/i;
const DIRECTIVE_VOTING_PATTERN = /\b(?:vote\s+for|must\s+support|we\s+recommend|our\s+pick|best\s+choice)\b/i;

interface BallotUniverseRace {
  slug: string;
  title: string;
  publicationStatus: "public" | "hidden";
  officialSourceIds?: string[];
}

test("homepage metadata contract uses public route counts without unsafe launch copy", async () => {
  const metadata = await generateHomeMetadata();
  const description = String(metadata.description);

  assert.equal(metadata.title, "votes.yayarea.news · San Francisco election guide");
  assert.match(description, /\b13 public races\b/);
  assert.match(description, /\b13 reviewed sources\b/);
  assert.match(description, /\b61 evidence items\b/);
  assertSafeMetadata(metadata);
});

test("public race static params are derived from the public loader gate and exclude sample, removed, and hidden records", async () => {
  const staticSlugs = (await generateRaceStaticParams()).map((param) => param.slug).sort();
  const ballotUniverse = await loadBallotUniverseRaces();
  const publicUniverseSlugs = ballotUniverse
    .filter((race) => race.publicationStatus === "public")
    .map((race) => race.slug)
    .sort();
  const hiddenUniverseSlugs = ballotUniverse
    .filter((race) => race.publicationStatus !== "public")
    .map((race) => race.slug);

  assert.deepEqual(staticSlugs, publicUniverseSlugs);
  assert.ok(staticSlugs.includes("california-governor"));
  assert.equal(staticSlugs.some((slug) => SAMPLE_OR_REMOVED_SLUG_PATTERN.test(slug)), false);
  for (const hiddenSlug of hiddenUniverseSlugs) {
    assert.equal(staticSlugs.includes(hiddenSlug), false, `${hiddenSlug} should stay behind the public gate`);
  }
});

test("representative race models keep agent diagnostics but public titles match official ballot data", async () => {
  const staticSlugs = new Set((await generateRaceStaticParams()).map((param) => param.slug));
  const ballotUniverse = await loadBallotUniverseRaces();

  await assertPublicRaceMatchesBallotUniverse("california-governor", staticSlugs, ballotUniverse);
  await assertPublicRaceMatchesBallotUniverse("supervisor-district-2", staticSlugs, ballotUniverse);
  await assertPublicRaceMatchesBallotUniverse("san-francisco-prop-a", staticSlugs, ballotUniverse);
});

test("ballot measure primary titles come from official ballot-universe titles when measures become public", async () => {
  const staticSlugs = new Set((await generateRaceStaticParams()).map((param) => param.slug));
  const ballotUniverse = await loadBallotUniverseRaces();
  const measureRaces = ballotUniverse.filter((race) => race.slug.includes("prop-"));

  assert.ok(measureRaces.length > 0, "ballot universe should enumerate tracked ballot measures");
  for (const measure of measureRaces) {
    const model = await buildRacePageModel(measure.slug);
    if (!staticSlugs.has(measure.slug)) {
      assert.equal(model, null, `${measure.slug} is not public and should not render a public page model`);
      continue;
    }

    assert.ok(model, `${measure.slug} should build when it is in static params`);
    assert.equal(model.ui.race.title, measure.title);
    assert.equal(model.ui.race.title.includes(":"), false, "expressive labels must not become primary measure titles");
    assert.equal(model.ui.race.title.includes(" — "), false, "expressive labels must not become primary measure titles");
    assert.ok((measure.officialSourceIds?.length ?? 0) > 0, `${measure.slug} should retain official source attribution`);
  }
});

test("unknown, sample, and pending-only public route classes return null instead of inventing pages", async () => {
  for (const slug of ["missing-race", "mayor", "sample-mayor", "sample-race", "supervisor-district-2", "san-francisco-prop-a"]) {
    const model = await buildRacePageModel(slug);
    if (slug === "supervisor-district-2" || slug === "san-francisco-prop-a") {
      const staticSlugs = new Set((await generateRaceStaticParams()).map((param) => param.slug));
      if (staticSlugs.has(slug)) continue;
    }
    assert.equal(model, null, `${slug} should not render unless the public loader gate admits it`);
  }
});

test("route model diagnostics stay available for agents even when launch pages hide diagnostic widgets", async () => {
  const raceModel = await buildRacePageModel("california-governor");

  assert.ok(raceModel);
  assert.equal(raceModel.diagnostics.reviewStatus, "verified");
  assert.equal(raceModel.diagnostics.publicationStatus, "public");
  assert.equal(raceModel.diagnostics.checkedFileCount, raceModel.checkedFiles.length);
  assert.ok(raceModel.diagnostics.matrixCellCount > 0);
  assert.ok(raceModel.diagnostics.receiptCount > 0);
});

test("public route component source hides launch-inappropriate diagnostic headings and checked-file disclosure widgets", async () => {
  for (const routePath of [
    path.join("app", "page.tsx"),
    path.join("app", "races", "[slug]", "page.tsx"),
    path.join("app", "sources", "[slug]", "page.tsx"),
    path.join("app", "entities", "[slug]", "page.tsx"),
    path.join("app", "how-we-use-ai", "page.tsx"),
  ]) {
    const source = await fs.readFile(path.join(process.cwd(), routePath), "utf8");
    assert.equal(DIAGNOSTIC_HEADING_PATTERN.test(source), false, `${routePath} exposes visible diagnostic copy`);
  }
});

test("public route component source does not contain private path disclosure patterns", async () => {
  for (const routePath of [
    path.join("app", "page.tsx"),
    path.join("app", "races", "[slug]", "page.tsx"),
    path.join("app", "sources", "[slug]", "page.tsx"),
    path.join("app", "entities", "[slug]", "page.tsx"),
    path.join("app", "how-we-use-ai", "page.tsx"),
  ]) {
    const source = await fs.readFile(path.join(process.cwd(), routePath), "utf8");
    assert.equal(PRIVATE_PATH_PATTERN.test(source), false, `${routePath} contains a private path pattern`);
  }
});

test("source and entity route component source uses public source-trail copy", async () => {
  for (const routePath of [
    path.join("app", "sources", "[slug]", "page.tsx"),
    path.join("app", "entities", "[slug]", "page.tsx"),
  ]) {
    const source = await fs.readFile(path.join(process.cwd(), routePath), "utf8");
    assert.equal(DRILLDOWN_IMPLEMENTATION_COPY_PATTERN.test(source), false, `${routePath} exposes implementation drill-down copy`);
    assert.equal(source.includes("Published position receipts"), true, `${routePath} should label receipts for readers`);
    assert.equal(source.includes("Public evidence details are not available for this reviewed position yet."), true, `${routePath} should have neutral missing-evidence copy`);
    assert.equal(source.includes("data-drilldown-evidence-status=\"unavailable\""), true, `${routePath} should keep unavailable evidence inspectable`);
  }
});

test("homepage, race, source, entity, and AI disclosure metadata are static, canonical, and safe", async () => {
  const metadataByPath: Array<[string, Metadata]> = [
    ["/", await generateHomeMetadata()],
    ["/races/california-governor/", await generateRaceMetadata({ params: Promise.resolve({ slug: "california-governor" }) })],
    ["/sources/california-secretary-of-state/", await generateSourceMetadata({ params: Promise.resolve({ slug: "california-secretary-of-state" }) })],
    ["/entities/california-governor-akinyemi-agbede/", await generateEntityMetadata({ params: Promise.resolve({ slug: "california-governor-akinyemi-agbede" }) })],
    ["/how-we-use-ai/", aiDisclosureMetadata],
  ];

  for (const [expectedPath, metadata] of metadataByPath) {
    assert.equal(metadata.alternates?.canonical, `${SITE_ORIGIN}${expectedPath}`);
    assertSafeMetadata(metadata);
  }
});

test("unsafe directive voting phrases fall back through metadata sanitization", () => {
  const metadata = buildShareMetadata({
    path: "/races/example",
    title: "We recommend Candidate A",
    description: "Vote for Candidate A because this is the best choice",
  });

  assert.equal(metadata.title, "votes.yayarea.news · San Francisco election guide");
  assert.equal(metadata.description, "Static public race discovery for San Francisco election source records, source counts, evidence receipts, and reviewed AI-use disclosure.");
  assertSafeMetadata(metadata);
});

async function assertPublicRaceMatchesBallotUniverse(slug: string, staticSlugs: Set<string>, ballotUniverse: BallotUniverseRace[]): Promise<void> {
  const officialRace = ballotUniverse.find((race) => race.slug === slug);
  assert.ok(officialRace, `${slug} should be tracked in ballot-universe.json`);

  const model = await buildRacePageModel(slug);
  if (!staticSlugs.has(slug)) {
    assert.equal(model, null, `${slug} should be absent until public`);
    assert.equal(officialRace.publicationStatus, "hidden");
    return;
  }

  assert.ok(model, `${slug} should build when public`);
  assert.equal(officialRace.publicationStatus, "public");
  assert.equal(model.ui.race.title, officialRace.title);
  assert.equal(model.diagnostics.reviewStatus, "verified");
  assert.equal(model.diagnostics.publicationStatus, "public");
}

async function loadBallotUniverseRaces(): Promise<BallotUniverseRace[]> {
  const filePath = path.join(process.cwd(), "data", "public", "ballot-universe.json");
  const json = JSON.parse(await fs.readFile(filePath, "utf8")) as { trackedRaces: BallotUniverseRace[] };
  return json.trackedRaces;
}

function assertSafeMetadata(metadata: Metadata): void {
  for (const value of collectStrings(metadata)) {
    assert.equal(PRIVATE_PATH_PATTERN.test(value), false, `metadata leaked private path: ${value}`);
    assert.equal(DIRECTIVE_VOTING_PATTERN.test(value), false, `metadata used directive voting language: ${value}`);
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value instanceof URL) return [value.toString()];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.values(value).flatMap(collectStrings);
}
