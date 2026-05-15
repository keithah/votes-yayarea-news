import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPublicRaceContext, type LoadedPublicRaceContext } from "../../lib/data/loaders";
import type { Entity, Race, Source } from "../../lib/data/types";
import { buildEntityDrilldownModel, buildSourceDrilldownModel } from "../../lib/ui/drilldowns";

test("builds an entity drill-down from public race contexts with receipt evidence and stable related slugs", async () => {
  const context = await loadPublicRaceContext("california-governor");
  assert.ok(context);

  const model = buildEntityDrilldownModel([context], "california-governor-akinyemi-agbede");

  assert.equal(model.kind, "entity");
  assert.equal(model.availability, "available");
  assert.equal(model.entity?.slug, "california-governor-akinyemi-agbede");
  assert.equal(model.entity?.name, "Akinyemi Agbede");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 1);
  assert.equal(model.counts.evidenceCount, 1);
  assert.equal(model.counts.sourceCount, 1);
  assert.deepEqual(model.relatedRaces.map((race) => race.slug), ["california-governor"]);
  assert.deepEqual(model.relatedSources.map((source) => source.slug), ["california-secretary-of-state"]);
  assert.equal(model.positions[0].race.slug, "california-governor");
  assert.equal(model.positions[0].source.slug, "california-secretary-of-state");
  assert.equal(model.positions[0].entity.slug, "california-governor-akinyemi-agbede");
  assert.equal(model.positions[0].receipt.status, "available");
  assert.equal(model.positions[0].evidence[0].id, "ev-sos-governor-akinyemi-agbede");
  assert.equal(model.positions[0].evidence[0].publicationStatus, "public");
  assert.equal(model.positions[0].evidence[0].reviewStatus, "verified");
  assert.equal(model.diagnostics.omittedPositionCount, 0);
  assert.doesNotThrow(() => JSON.stringify(model));
});

test("builds a source drill-down grouped by public race/entity with receipt evidence", async () => {
  const context = await loadPublicRaceContext("california-governor");
  assert.ok(context);

  const model = buildSourceDrilldownModel([context], "california-secretary-of-state");

  assert.equal(model.kind, "source");
  assert.equal(model.availability, "available");
  assert.equal(model.source?.slug, "california-secretary-of-state");
  assert.equal(model.source?.name, "California Secretary of State");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 61);
  assert.equal(model.counts.evidenceCount, 61);
  assert.equal(model.counts.entityCount, 61);
  assert.deepEqual(model.relatedRaces.map((race) => race.slug), ["california-governor"]);
  assert.ok(model.relatedEntities.some((entity) => entity.slug === "california-governor-akinyemi-agbede"));
  assert.equal(model.relatedEntities.length, 61);
  assert.equal(model.positions[0].position.kind, "informational");
  assert.equal(model.positions[0].receipt.cellId, "cell:src-ca-secretary-of-state::ent-california-governor-akinyemi-agbede");
  assert.equal(model.positions[0].evidence[0].source.label, "California Secretary of State");
  assert.equal(model.diagnostics.omittedPositionCount, 0);
  assert.doesNotThrow(() => JSON.stringify(model));
});

test("unknown entity and source slugs return explicit unavailable models", async () => {
  const context = await loadPublicRaceContext("california-governor");
  assert.ok(context);

  const entityModel = buildEntityDrilldownModel([context], "missing-candidate");
  const sourceModel = buildSourceDrilldownModel([context], "missing-source");

  assert.equal(entityModel.availability, "unavailable");
  assert.equal(entityModel.unavailableReason, "unknown-slug");
  assert.equal(entityModel.entity, null);
  assert.deepEqual(entityModel.positions, []);
  assert.equal(entityModel.diagnostics.checkedRaceCount, 1);
  assert.equal(sourceModel.availability, "unavailable");
  assert.equal(sourceModel.unavailableReason, "unknown-slug");
  assert.equal(sourceModel.source, null);
  assert.deepEqual(sourceModel.positions, []);
});

test("known entity or source with no public positions is distinct from an unknown slug", () => {
  const context = contextWith({ positions: [] });

  const entityModel = buildEntityDrilldownModel([context], "alice");
  const sourceModel = buildSourceDrilldownModel([context], "editorial-board");

  assert.equal(entityModel.entity?.id, "ent-a");
  assert.equal(entityModel.availability, "unavailable");
  assert.equal(entityModel.unavailableReason, "no-public-positions");
  assert.equal(entityModel.counts.publicPositionCount, 0);
  assert.equal(sourceModel.source?.id, "src-one");
  assert.equal(sourceModel.availability, "unavailable");
  assert.equal(sourceModel.unavailableReason, "no-public-positions");
  assert.equal(sourceModel.counts.publicPositionCount, 0);
});

test("hidden and draft recommendations filtered by the public loader never enter drill-down models", async () => {
  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: {
      status: "verified",
      publicationStatus: "public",
      positions: [
        { id: "pos-sos-governor-akinyemi-agbede", status: "verified", publicationStatus: "public" },
        { id: "pos-sos-governor-mohammad-arif", status: "draft", publicationStatus: "hidden" },
        {
          id: "pos-hidden-verified-candidate-b",
          raceId: "race-california-governor",
          sourceId: "src-ca-secretary-of-state",
          entityId: "ent-california-governor-mohammad-arif",
          kind: "endorse",
          status: "verified",
          publicationStatus: "hidden",
          label: "Hidden verified generated draft",
          evidenceIds: ["ev-hidden-verified-candidate-b"],
          evidence: [
            {
              id: "ev-hidden-verified-candidate-b",
              sourceId: "src-ca-secretary-of-state",
              entityId: "ent-california-governor-mohammad-arif",
              raceId: "race-california-governor",
              url: "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf",
              kind: "quote",
              quote: "Hidden verified fixture evidence must not become public.",
            },
          ],
        },
      ],
      summary: { id: "sum-governor-fixture", status: "verified", publicationStatus: "public", text: "Fixture summary", evidenceIds: ["ev-sos-governor-akinyemi-agbede", "ev-hidden-verified-candidate-b"] },
    },
  });
  const context = await loadPublicRaceContext("california-governor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.ok(context);

  const hiddenEntityModel = buildEntityDrilldownModel([context], "california-governor-mohammad-arif");
  const publicEntityModel = buildEntityDrilldownModel([context], "california-governor-akinyemi-agbede");

  assert.equal(hiddenEntityModel.availability, "unavailable");
  assert.equal(hiddenEntityModel.unavailableReason, "no-public-positions");
  assert.deepEqual(hiddenEntityModel.positions, []);
  assert.equal(JSON.stringify(hiddenEntityModel).includes("Hidden verified fixture evidence"), false);
  assert.equal(publicEntityModel.availability, "available");
  assert.deepEqual(publicEntityModel.positions.map((group) => group.position.id), ["pos-sos-governor-akinyemi-agbede"]);
});

test("evidence ids without public receipt support are not fabricated", () => {
  const context = contextWith({
    positions: [
      position("pos-one", "src-one", "ent-a", ["ev-one"], {
        evidenceIds: ["ev-one", "ev-missing"],
      }),
    ],
  });

  const model = buildEntityDrilldownModel([context], "alice");

  assert.equal(model.availability, "available");
  assert.equal(model.counts.evidenceCount, 1);
  assert.deepEqual(model.positions[0].receipt.evidenceIds, ["ev-one"]);
  assert.deepEqual(model.positions[0].evidence.map((evidence) => evidence.id), ["ev-one"]);
  assert.equal(JSON.stringify(model).includes("ev-missing"), false);
});

test("malformed public contexts omit rows with missing referenced records instead of throwing", () => {
  const context = contextWith({
    sources: [],
    positions: [position("pos-one", "src-one", "ent-a", ["ev-one"])],
  });

  const model = buildEntityDrilldownModel([context], "alice");

  assert.equal(model.availability, "unavailable");
  assert.equal(model.unavailableReason, "no-public-positions");
  assert.deepEqual(model.positions, []);
  assert.equal(model.diagnostics.omittedPositionCount, 1);
  assert.equal(model.diagnostics.omittedPositions[0].reason, "missing-source");
});

async function createFixture(): Promise<{ publicDir: string; overridesDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-drilldown-"));
  const publicDir = path.join(root, "data", "public");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  return { publicDir, overridesDir };
}

async function writeOverride(overridesDir: string, value: unknown): Promise<void> {
  await fs.mkdir(path.join(overridesDir, "races"), { recursive: true });
  await fs.writeFile(path.join(overridesDir, "races", "california-governor.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function contextWith(overrides: Partial<LoadedPublicRaceContext & { positions: Race["positions"] }> = {}): LoadedPublicRaceContext {
  const sources = overrides.sources ?? [source("src-one", "editorial-board", "Editorial Board")];
  const entities = overrides.entities ?? [entity("ent-a", "alice", "Alice")];
  const positions = overrides.positions ?? [position("pos-one", "src-one", "ent-a", ["ev-one"] )];
  return {
    race: {
      id: "race-test",
      slug: "test-race",
      title: "Test Race",
      kind: "local-executive",
      status: "verified",
      publicationStatus: "public",
      electionDate: "2026-06-02",
      jurisdiction: "California",
      sourceIds: sources.map((item) => item.id),
      entityIds: entities.map((item) => item.id),
      positions,
    },
    sources,
    entities,
    checkedFiles: ["data/public/races/test-race.json"],
  };
}

function source(id: string, slug: string, name: string): Source {
  return {
    id,
    slug,
    name,
    category: "Fixture",
    sourceType: "editorial endorsements",
    status: "active",
    homepageUrl: `https://example.com/${slug}`,
  };
}

function entity(id: string, slug: string, name: string): Entity {
  return {
    id,
    slug,
    name,
    kind: "candidate",
    status: "verified",
    description: `${name} fixture`,
  };
}

function position(id: string, sourceId: string, entityId: string, evidenceIds: string[], overrides: Partial<Race["positions"][number]> = {}): Race["positions"][number] {
  const evidence = evidenceIds.map((evidenceId) => ({
    id: evidenceId,
    sourceId,
    entityId,
    raceId: "race-test",
    artifactId: `art-${evidenceId}`,
    chunkId: `chunk-${evidenceId}`,
    url: `https://example.com/${evidenceId}`,
    kind: "quote" as const,
    quote: `${evidenceId} quote`,
  }));
  return {
    id,
    raceId: "race-test",
    sourceId,
    entityId,
    kind: "endorse",
    status: "verified",
    publicationStatus: "public",
    label: "Endorse Alice",
    rationale: "Fixture rationale",
    evidenceIds,
    evidence,
    ...overrides,
  };
}
