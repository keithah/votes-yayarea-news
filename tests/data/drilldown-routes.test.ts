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
  assert.deepEqual(await generateEntityStaticParams(), [{ slug: "sample-candidate-a" }, { slug: "sample-candidate-b" }]);
  assert.deepEqual(await generateSourceStaticParams(), [{ slug: "growsf-voter-guide" }, { slug: "san-francisco-chronicle-editorial-board" }]);
});

test("entity page model exposes public recommendation receipts, diagnostics, and related links", async () => {
  const model = await buildEntityPageModel("sample-candidate-a");

  assert.ok(model);
  assert.equal(model.kind, "entity");
  assert.equal(model.entity?.name, "Sample Candidate A");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 1);
  assert.equal(model.counts.evidenceCount, 1);
  assert.equal(model.counts.sourceCount, 1);
  assert.deepEqual(model.relatedRaces.map((race) => `/races/${race.slug}/`), ["/races/mayor/"]);
  assert.deepEqual(model.relatedSources.map((source) => `/sources/${source.slug}/`), ["/sources/san-francisco-chronicle-editorial-board/"]);
  assert.equal(model.positions[0].position.reviewStatus, "verified");
  assert.equal(model.positions[0].position.publicationStatus, "public");
  assert.equal(model.positions[0].receipt.status, "available");
  assert.equal(model.positions[0].evidence[0].id, "ev-sf-chronicle-sample-candidate-a-1-1");
  assert.equal(model.positions[0].evidence[0].publicationStatus, "public");
  assert.equal(model.diagnostics.requestedSlug, "sample-candidate-a");
  assert.equal(model.diagnostics.relatedRaceCount, 1);
  assert.equal(model.diagnostics.publicPositionCount, 1);
  assert.equal(model.diagnostics.evidenceCount, 1);
  assert.equal(model.diagnostics.checkedFileCount, model.checkedFiles.length);
  assert.ok(model.diagnostics.checkedFileCount > 0);
  assert.equal(model.checkedFiles.some((file) => GSD_PATH.test(file)), false);
});

test("source page model exposes public recommendation receipts, diagnostics, and related links", async () => {
  const model = await buildSourcePageModel("san-francisco-chronicle-editorial-board");

  assert.ok(model);
  assert.equal(model.kind, "source");
  assert.equal(model.source?.name, "San Francisco Chronicle Editorial Board");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 1);
  assert.equal(model.counts.evidenceCount, 1);
  assert.equal(model.counts.entityCount, 1);
  assert.deepEqual(model.relatedRaces.map((race) => `/races/${race.slug}/`), ["/races/mayor/"]);
  assert.deepEqual(model.relatedEntities.map((entity) => `/entities/${entity.slug}/`), ["/entities/sample-candidate-a/"]);
  assert.equal(model.positions[0].entity.slug, "sample-candidate-a");
  assert.equal(model.positions[0].position.reviewStatus, "verified");
  assert.equal(model.positions[0].position.publicationStatus, "public");
  assert.equal(model.positions[0].evidence[0].url, "https://www.sfchronicle.com/projects/2026/sample-voter-guide/mayor");
  assert.equal(model.diagnostics.requestedSlug, "san-francisco-chronicle-editorial-board");
  assert.equal(model.diagnostics.relatedRaceCount, 1);
  assert.equal(model.diagnostics.publicPositionCount, 1);
  assert.equal(model.diagnostics.evidenceCount, 1);
  assert.equal(model.diagnostics.checkedFileCount, model.checkedFiles.length);
  assert.ok(model.diagnostics.checkedFileCount > 0);
  assert.equal(model.checkedFiles.some((file) => GSD_PATH.test(file)), false);
});

test("entity and source page models return null for unknown or non-public slugs", async () => {
  assert.equal(await buildEntityPageModel("missing-candidate"), null);
  assert.equal(await buildSourcePageModel("missing-source"), null);

  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: {
      status: "verified",
      publicationStatus: "public",
      positions: [
        { id: "pos-chronicle-candidate-a", status: "draft", publicationStatus: "hidden" },
        { id: "pos-growsf-candidate-b", status: "draft", publicationStatus: "hidden" },
      ],
      summary: { status: "draft", publicationStatus: "hidden" },
    },
  });

  assert.equal(await buildEntityPageModel("sample-candidate-a", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
  assert.equal(await buildSourcePageModel("san-francisco-chronicle-editorial-board", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

test("race page model still marks drill-down readiness and page source links to entity and source routes", async () => {
  const model = await buildRacePageModel("mayor");
  assert.ok(model);
  assert.equal(model.ui.placeholders.drilldownReady, true);

  const pageSource = await fs.readFile(path.join(process.cwd(), "app", "races", "[slug]", "page.tsx"), "utf8");
  assert.equal(pageSource.includes("/entities/${candidate.slug}/"), true);
  assert.equal(pageSource.includes("/sources/${source.slug}/"), true);
  assert.equal(pageSource.includes("Candidate drill-down paths will use trailing-slash routes"), false);
  assert.equal(pageSource.includes("Source drill-down paths will use trailing-slash routes"), false);
  assert.equal(pageSource.includes("title=\"Entity pages\""), false);
});

test("entity and source route components expose drill-down diagnostic attributes", async () => {
  const entitySource = await fs.readFile(path.join(process.cwd(), "app", "entities", "[slug]", "page.tsx"), "utf8");
  const sourceSource = await fs.readFile(path.join(process.cwd(), "app", "sources", "[slug]", "page.tsx"), "utf8");

  for (const routeSource of [entitySource, sourceSource]) {
    assert.equal(routeSource.includes("data-drilldown-slug"), true);
    assert.equal(routeSource.includes("data-related-race-count"), true);
    assert.equal(routeSource.includes("data-recommendation-count"), true);
    assert.equal(routeSource.includes("data-evidence-count"), true);
    assert.equal(routeSource.includes("data-checked-file-count"), true);
    assert.equal(routeSource.includes("data-drilldown-evidence-id"), true);
    assert.equal(routeSource.includes("data-drilldown-evidence-source-url"), true);
    assert.equal(routeSource.includes("data-drilldown-evidence-publication-status"), true);
  }
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
  await fs.writeFile(path.join(overridesDir, "races", "mayor.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
