import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPublicRaceContext, type LoadedPublicRaceContext } from "../../lib/data/loaders";
import type { Entity, Race, Source } from "../../lib/data/types";
import { buildEntityDrilldownModel, buildSourceDrilldownModel } from "../../lib/ui/drilldowns";

test("builds an entity drill-down from public race contexts with receipt evidence and stable related slugs", async () => {
  const context = await loadPublicRaceContext("mayor");
  assert.ok(context);

  const model = buildEntityDrilldownModel([context], "sample-candidate-a");

  assert.equal(model.kind, "entity");
  assert.equal(model.availability, "available");
  assert.equal(model.entity?.slug, "sample-candidate-a");
  assert.equal(model.entity?.name, "Sample Candidate A");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 1);
  assert.equal(model.counts.evidenceCount, 1);
  assert.equal(model.counts.sourceCount, 1);
  assert.deepEqual(model.relatedRaces.map((race) => race.slug), ["mayor"]);
  assert.deepEqual(model.relatedSources.map((source) => source.slug), ["san-francisco-chronicle-editorial-board"]);
  assert.equal(model.positions[0].race.slug, "mayor");
  assert.equal(model.positions[0].source.slug, "san-francisco-chronicle-editorial-board");
  assert.equal(model.positions[0].entity.slug, "sample-candidate-a");
  assert.equal(model.positions[0].receipt.status, "available");
  assert.equal(model.positions[0].evidence[0].id, "ev-sf-chronicle-sample-candidate-a-1-1");
  assert.equal(model.positions[0].evidence[0].publicationStatus, "public");
  assert.equal(model.positions[0].evidence[0].reviewStatus, "verified");
  assert.equal(model.diagnostics.omittedPositionCount, 0);
  assert.doesNotThrow(() => JSON.stringify(model));
});

test("builds a source drill-down grouped by public race/entity with receipt evidence", async () => {
  const context = await loadPublicRaceContext("mayor");
  assert.ok(context);

  const model = buildSourceDrilldownModel([context], "growsf-voter-guide");

  assert.equal(model.kind, "source");
  assert.equal(model.availability, "available");
  assert.equal(model.source?.slug, "growsf-voter-guide");
  assert.equal(model.source?.name, "GrowSF Voter Guide");
  assert.equal(model.counts.relatedRaceCount, 1);
  assert.equal(model.counts.publicPositionCount, 1);
  assert.equal(model.counts.evidenceCount, 1);
  assert.equal(model.counts.entityCount, 1);
  assert.deepEqual(model.relatedRaces.map((race) => race.slug), ["mayor"]);
  assert.deepEqual(model.relatedEntities.map((entity) => entity.slug), ["sample-candidate-b"]);
  assert.equal(model.positions[0].position.kind, "informational");
  assert.equal(model.positions[0].receipt.cellId, "cell:src-growsf::ent-sample-candidate-b");
  assert.equal(model.positions[0].evidence[0].source.label, "GrowSF Voter Guide");
  assert.equal(model.diagnostics.omittedPositionCount, 0);
  assert.doesNotThrow(() => JSON.stringify(model));
});

test("unknown entity and source slugs return explicit unavailable models", async () => {
  const context = await loadPublicRaceContext("mayor");
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
        { id: "pos-chronicle-candidate-a", status: "verified", publicationStatus: "public" },
        { id: "pos-growsf-candidate-b", status: "draft", publicationStatus: "hidden" },
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
      summary: { status: "verified", publicationStatus: "public", evidenceIds: ["ev-chronicle-candidate-a", "ev-hidden-verified-candidate-b"] },
    },
  });
  const context = await loadPublicRaceContext("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir });
  assert.ok(context);

  const hiddenEntityModel = buildEntityDrilldownModel([context], "sample-candidate-b");
  const publicEntityModel = buildEntityDrilldownModel([context], "sample-candidate-a");

  assert.equal(hiddenEntityModel.availability, "unavailable");
  assert.equal(hiddenEntityModel.unavailableReason, "no-public-positions");
  assert.deepEqual(hiddenEntityModel.positions, []);
  assert.equal(JSON.stringify(hiddenEntityModel).includes("Hidden verified fixture evidence"), false);
  assert.equal(publicEntityModel.availability, "available");
  assert.deepEqual(publicEntityModel.positions.map((group) => group.position.id), ["pos-chronicle-candidate-a"]);
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
  await fs.writeFile(path.join(overridesDir, "races", "mayor.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
      jurisdiction: "San Francisco",
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
