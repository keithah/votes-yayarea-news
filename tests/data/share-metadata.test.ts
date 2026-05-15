import test from "node:test";
import assert from "node:assert/strict";
import type { Metadata } from "next";
import { generateMetadata as generateEntityMetadata } from "../../app/entities/[slug]/page";
import { generateMetadata as generateHomeMetadata } from "../../app/page";
import { generateMetadata as generateRaceMetadata } from "../../app/races/[slug]/page";
import { generateMetadata as generateSourceMetadata } from "../../app/sources/[slug]/page";
import { metadata as disclosureMetadata } from "../../app/how-we-use-ai/page";
import {
  absoluteAssetUrl,
  absoluteUrl,
  buildShareMetadata,
  DEFAULT_SHARE_IMAGE_PATH,
  normalizeCanonicalPath,
  sanitizeShareText,
  SITE_ORIGIN,
} from "../../lib/share/metadata";

const PRIVATE_PATH_PATTERN = /(?:\.gsd|manual\/(?:reviews|overrides)\/|data\/(?:public|extracted|ingested)\/|\/home\/|file:|tmp\/)/i;
const ENDORSEMENT_PHRASES = /\b(?:vote\s+for|must\s+support|we\s+recommend|our\s+pick|best\s+choice)\b/i;

test("share metadata helper normalizes canonical URLs and static share image URLs", () => {
  assert.equal(normalizeCanonicalPath("/races/mayor"), "/races/mayor/");
  assert.equal(normalizeCanonicalPath("races/mayor?draft=1"), "/races/mayor/");
  assert.equal(normalizeCanonicalPath("/"), "/");
  assert.equal(absoluteUrl("/races/mayor"), `${SITE_ORIGIN}/races/mayor/`);
  assert.equal(absoluteAssetUrl(DEFAULT_SHARE_IMAGE_PATH), `${SITE_ORIGIN}/share/votes-yayarea-news.svg`);
});

test("share metadata helper falls back for unsafe, empty, or directive-like metadata text", () => {
  assert.equal(sanitizeShareText(""), "Public San Francisco election source records and evidence receipts.");
  assert.equal(sanitizeShareText("Inspect .gsd/milestones/M001 for this route"), "Public San Francisco election source records and evidence receipts.");
  assert.equal(sanitizeShareText("We recommend Candidate A"), "Public San Francisco election source records and evidence receipts.");
});

test("homepage metadata exposes static public counts and share card fields", async () => {
  const metadata = await generateHomeMetadata();

  assert.equal(metadata.title, "votes.yayarea.news · San Francisco election guide");
  assert.equal(metadata.description, "Static San Francisco election source tracker with 1 public races, 2 reviewed sources, and 2 evidence items.");
  assertMetadataCommonFields(metadata, "/");
  assertSafeMetadata(metadata);
});

test("race metadata describes public source records without telling readers how to vote", async () => {
  const metadata = await generateRaceMetadata({ params: Promise.resolve({ slug: "mayor" }) });

  assert.equal(metadata.title, "San Francisco Mayor source records");
  assert.equal(metadata.description, "Public source tracker for San Francisco Mayor: 2 sources, 2 entities, and 2 evidence items.");
  assertMetadataCommonFields(metadata, "/races/mayor/");
  assertSafeMetadata(metadata);
});

test("entity metadata describes the public source trail and evidence counts", async () => {
  const metadata = await generateEntityMetadata({ params: Promise.resolve({ slug: "sample-candidate-a" }) });

  assert.equal(metadata.title, "Sample Candidate A public source trail");
  assert.equal(metadata.description, "Sample Candidate A public source trail across 1 races: 1 tracked source records and 1 evidence items.");
  assertMetadataCommonFields(metadata, "/entities/sample-candidate-a/");
  assertSafeMetadata(metadata);
});

test("source metadata describes the public source trail and evidence counts", async () => {
  const metadata = await generateSourceMetadata({ params: Promise.resolve({ slug: "san-francisco-chronicle-editorial-board" }) });

  assert.equal(metadata.title, "San Francisco Chronicle Editorial Board public source trail");
  assert.equal(metadata.description, "San Francisco Chronicle Editorial Board public source trail across 1 races: 1 tracked source records and 1 evidence items.");
  assertMetadataCommonFields(metadata, "/sources/san-francisco-chronicle-editorial-board/");
  assertSafeMetadata(metadata);
});

test("AI disclosure metadata uses the same static share-card surface", () => {
  assert.equal(disclosureMetadata.title, "How we use AI");
  assert.equal(
    disclosureMetadata.description,
    "How votes.yayarea.news uses AI assistance, human review, evidence, and publication gates for public election source records.",
  );
  assertMetadataCommonFields(disclosureMetadata, "/how-we-use-ai/");
  assertSafeMetadata(disclosureMetadata);
});

test("unknown route metadata falls back to safe site-level metadata at the requested canonical path", async () => {
  const race = await generateRaceMetadata({ params: Promise.resolve({ slug: "missing-race" }) });
  const entity = await generateEntityMetadata({ params: Promise.resolve({ slug: "missing-candidate" }) });
  const source = await generateSourceMetadata({ params: Promise.resolve({ slug: "missing-source" }) });

  assert.equal(race.title, "votes.yayarea.news · San Francisco election guide");
  assert.equal(entity.title, "votes.yayarea.news · San Francisco election guide");
  assert.equal(source.title, "votes.yayarea.news · San Francisco election guide");
  assertMetadataCommonFields(race, "/races/missing-race/");
  assertMetadataCommonFields(entity, "/entities/missing-candidate/");
  assertMetadataCommonFields(source, "/sources/missing-source/");
  for (const metadata of [race, entity, source]) assertSafeMetadata(metadata);
});

test("missing descriptions and custom unsafe inputs cannot leak local paths into social tags", () => {
  const metadata = buildShareMetadata({
    path: "/sources/example",
    title: "manual/reviews/races/mayor.json",
    description: "file:///home/keith/src/yayarea.news/votes/data/public/sources.json",
  });

  assert.equal(metadata.title, "votes.yayarea.news · San Francisco election guide");
  assert.equal(metadata.description, "Static public race discovery for San Francisco election source records, source counts, evidence receipts, and reviewed AI-use disclosure.");
  assertMetadataCommonFields(metadata, "/sources/example/");
  assertSafeMetadata(metadata);
});

function assertMetadataCommonFields(metadata: Metadata, expectedPath: string): void {
  const expectedCanonical = `${SITE_ORIGIN}${expectedPath}`;
  const openGraph = metadata.openGraph as NonNullable<Metadata["openGraph"]> & { images: Array<{ url: string; alt: string; type: string }> };
  const twitter = metadata.twitter as Record<string, unknown> & { images: string[] };

  assert.equal(metadata.alternates?.canonical, expectedCanonical);
  assert.equal(openGraph.url, expectedCanonical);
  assert.equal(openGraph.siteName, "votes.yayarea.news");
  assert.equal(openGraph.images[0].url, `${SITE_ORIGIN}/share/votes-yayarea-news.svg`);
  assert.equal(openGraph.images[0].type, "image/svg+xml");
  assert.equal(twitter.card, "summary_large_image");
  assert.deepEqual(twitter.images, [`${SITE_ORIGIN}/share/votes-yayarea-news.svg`]);
}

function assertSafeMetadata(metadata: Metadata): void {
  for (const value of collectStrings(metadata)) {
    assert.equal(PRIVATE_PATH_PATTERN.test(value), false, `metadata leaked private path: ${value}`);
    assert.equal(ENDORSEMENT_PHRASES.test(value), false, `metadata used directive endorsement language: ${value}`);
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value instanceof URL) return [value.toString()];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.values(value).flatMap(collectStrings);
}
