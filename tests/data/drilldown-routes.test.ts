import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEntityPageModel, generateStaticParams as generateEntityStaticParams } from "../../app/entities/[slug]/page";
import { buildRacePageModel } from "../../app/races/[slug]/page";
import { buildSourcePageModel, generateStaticParams as generateSourceStaticParams } from "../../app/sources/[slug]/page";

const GSD_PATH = /(^|\/)\.gsd(\/|$)/;

test("entity and source routes statically generate public recommendation slugs only", async () => {
  const entityParams = await generateEntityStaticParams();
  assert.equal(entityParams.length, 61);
  assert.ok(entityParams.some((param) => param.slug === "california-governor-akinyemi-agbede"));
  assert.equal(entityParams.some((param) => param.slug === "sample-candidate-a"), false);
  const sourceParams = await generateSourceStaticParams();
  assert.deepEqual(sourceParams, [{ slug: "california-secretary-of-state" }]);
  assert.equal(sourceParams.some((param) => param.slug === "san-francisco-department-of-elections"), false);
  assert.equal(sourceParams.some((param) => param.slug === "mission-local"), false);
  assert.equal(sourceParams.some((param) => param.slug === "san-francisco-standard"), false);
});

test("entity page model exposes public recommendation receipts, diagnostics, and related links", async () => {
  const model = await buildEntityPageModel("california-governor-akinyemi-agbede");

  assert.ok(model);
  assert.equal(model.kind, "entity");
  assert.equal(model.entity?.name, "Akinyemi Agbede");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 1);
  assert.equal(model.counts.evidenceCount, 1);
  assert.equal(model.counts.sourceCount, 1);
  assert.deepEqual(model.relatedRaces.map((race) => `/races/${race.slug}/`), ["/races/california-governor/"]);
  assert.deepEqual(model.relatedSources.map((source) => `/sources/${source.slug}/`), ["/sources/california-secretary-of-state/"]);
  assert.equal(model.positions[0].position.reviewStatus, "verified");
  assert.equal(model.positions[0].position.publicationStatus, "public");
  assert.equal(model.positions[0].receipt.status, "available");
  assert.equal(model.positions[0].evidence[0].id, "ev-sos-governor-akinyemi-agbede");
  assert.equal(model.positions[0].evidence[0].publicationStatus, "public");
  assert.equal(model.diagnostics.requestedSlug, "california-governor-akinyemi-agbede");
  assert.equal(model.diagnostics.relatedRaceCount, 1);
  assert.equal(model.diagnostics.publicPositionCount, 1);
  assert.equal(model.diagnostics.evidenceCount, 1);
  assert.equal(model.diagnostics.checkedFileCount, model.checkedFiles.length);
  assert.ok(model.diagnostics.checkedFileCount > 0);
  assert.equal(model.checkedFiles.some((file) => GSD_PATH.test(file)), false);
});

test("source page model exposes public recommendation receipts, diagnostics, and related links", async () => {
  const model = await buildSourcePageModel("california-secretary-of-state");

  assert.ok(model);
  assert.equal(model.kind, "source");
  assert.equal(model.source?.name, "California Secretary of State");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 61);
  assert.equal(model.counts.evidenceCount, 61);
  assert.equal(model.counts.entityCount, 61);
  assert.deepEqual(model.relatedRaces.map((race) => `/races/${race.slug}/`), ["/races/california-governor/"]);
  assert.ok(model.relatedEntities.some((entity) => entity.slug === "california-governor-akinyemi-agbede"));
  assert.equal(model.positions[0].entity.slug, "california-governor-akinyemi-agbede");
  assert.equal(model.positions[0].position.reviewStatus, "verified");
  assert.equal(model.positions[0].position.publicationStatus, "public");
  assert.equal(model.positions[0].evidence[0].url, "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf");
  assert.equal(model.diagnostics.requestedSlug, "california-secretary-of-state");
  assert.equal(model.diagnostics.relatedRaceCount, 1);
  assert.equal(model.diagnostics.publicPositionCount, 61);
  assert.equal(model.diagnostics.evidenceCount, 61);
  assert.equal(model.diagnostics.checkedFileCount, model.checkedFiles.length);
  assert.ok(model.diagnostics.checkedFileCount > 0);
  assert.equal(model.checkedFiles.some((file) => GSD_PATH.test(file)), false);
});

test("entity and source page models return null for unknown, hidden-race, pending-only, and registry-only slugs", async () => {
  assert.equal(await buildEntityPageModel("missing-candidate"), null);
  assert.equal(await buildSourcePageModel("missing-source"), null);
  assert.equal(await buildEntityPageModel("california-lieutenant-governor-josh-fryday"), null);
  assert.equal(await buildSourcePageModel("san-francisco-department-of-elections"), null);
  assert.equal(await buildSourcePageModel("mission-local"), null);
  assert.equal(await buildSourcePageModel("san-francisco-standard"), null);

  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: { status: "draft", publicationStatus: "hidden" },
  });

  assert.equal(await buildEntityPageModel("california-governor-akinyemi-agbede", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
  assert.equal(await buildSourcePageModel("california-secretary-of-state", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

test("race page model still marks drill-down readiness and page source links to entity and source routes", async () => {
  const model = await buildRacePageModel("california-governor");
  assert.ok(model);
  assert.equal(model.ui.placeholders.drilldownReady, true);

  const pageSource = await fs.readFile(path.join(process.cwd(), "app", "races", "[slug]", "page.tsx"), "utf8");
  assert.equal(pageSource.includes("/entities/${candidate.slug}/"), true);
  assert.equal(pageSource.includes("/sources/${source.slug}/"), true);
  assert.equal(pageSource.includes("Candidate drill-down paths will use trailing-slash routes"), false);
  assert.equal(pageSource.includes("Source drill-down paths will use trailing-slash routes"), false);
  assert.equal(pageSource.includes("title=\"Entity pages\""), false);
});

test("entity and source route components expose drill-down diagnostic attributes and public receipt copy", async () => {
  const entitySource = await fs.readFile(path.join(process.cwd(), "app", "entities", "[slug]", "page.tsx"), "utf8");
  const sourceSource = await fs.readFile(path.join(process.cwd(), "app", "sources", "[slug]", "page.tsx"), "utf8");

  for (const routeSource of [entitySource, sourceSource]) {
    assert.equal(routeSource.includes("data-drilldown-slug"), true);
    assert.equal(routeSource.includes("data-related-race-count"), true);
    assert.equal(routeSource.includes("data-recommendation-count"), true);
    assert.equal(routeSource.includes("data-evidence-count"), true);
    assert.equal(routeSource.includes("data-checked-file-count"), false);
    assert.equal(routeSource.includes("data-drilldown-evidence-id"), true);
    assert.equal(routeSource.includes("data-drilldown-evidence-source-url"), true);
    assert.equal(routeSource.includes("data-drilldown-evidence-publication-status"), true);
    assert.equal(routeSource.includes("data-drilldown-evidence-status=\"unavailable\""), true);
    assert.equal(routeSource.includes("Public evidence details are not available for this reviewed position yet."), true);
    assert.equal(routeSource.includes("Source URL"), false);
    assert.equal(routeSource.includes("Published position receipts"), true);
    assert.equal(routeSource.includes("Source:"), true);
  }

  assert.equal(entitySource.includes("Entity drill-down"), false);
  assert.equal(sourceSource.includes("Source drill-down"), false);
});

async function createFixture(): Promise<{ publicDir: string; overridesDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-drilldown-routes-"));
  const publicDir = path.join(root, "data", "public");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  return { publicDir, overridesDir };
}

async function writeOverride(overridesDir: string, value: unknown): Promise<void> {
  await fs.mkdir(path.join(overridesDir, "races"), { recursive: true });
  await fs.writeFile(path.join(overridesDir, "races", "california-governor.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
