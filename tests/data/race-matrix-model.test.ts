import test from "node:test";
import assert from "node:assert/strict";
import { loadPublicRaceContext } from "../../lib/data/loaders";
import type { Entity, Race, Source } from "../../lib/data/types";
import { buildRaceUiModel, buildRecommendationMatrixModel } from "../../lib/ui/race";

test("builds sample mayor recommendation matrix from public UI model", async () => {
  const context = await loadPublicRaceContext("mayor");

  assert.ok(context);
  const ui = buildRaceUiModel(context);
  const matrix = buildRecommendationMatrixModel(ui);

  assert.equal(matrix.raceId, "race-mayor");
  assert.equal(matrix.empty, false);
  assert.deepEqual(
    matrix.candidates.map((candidate) => candidate.id),
    ["ent-sample-candidate-a", "ent-sample-candidate-b"],
  );
  assert.deepEqual(
    matrix.sources.map((source) => source.id),
    ["src-growsf", "src-sf-chronicle"],
    "rows are deterministically grouped by source type then source name",
  );
  assert.deepEqual(
    matrix.groups.map((group) => ({ id: group.id, sourceType: group.sourceType, sourceIds: group.sourceIds })),
    [
      { id: "source-type:civic-voter-guide-recommendations", sourceType: "civic voter guide / recommendations", sourceIds: ["src-growsf"] },
      { id: "source-type:editorial-endorsements", sourceType: "editorial endorsements", sourceIds: ["src-sf-chronicle"] },
    ],
  );
  assert.equal(matrix.defaultSort.key, "source-type-then-name");
  assert.equal(matrix.defaultGrouping.key, "sourceType");

  const growsfCandidateB = matrix.cells["src-growsf::ent-sample-candidate-b"];
  assert.equal(growsfCandidateB.state, "position");
  assert.equal(growsfCandidateB.positionKind, "informational");
  assert.equal(growsfCandidateB.positionKindLabel, "Informational");
  assert.deepEqual(growsfCandidateB.positionIds, ["pos-growsf-sample-candidate-b-1"]);
  assert.equal(growsfCandidateB.evidenceCount, 1);
  assert.deepEqual(growsfCandidateB.evidenceIds, ["ev-growsf-sample-candidate-b-1-1"]);
});

test("emits neutral cells for missing source-candidate pairs without inferring recommendations", () => {
  const ui = buildRaceUiModel({
    race: publicRace({
      sourceIds: ["src-one", "src-two"],
      entityIds: ["ent-a", "ent-b"],
      positions: [position("pos-one", "src-one", "ent-a", "endorse", ["ev-one"])],
    }),
    sources: [source("src-one", "Editorial", "editorial endorsements"), source("src-two", "Guide", "voter guides")],
    entities: [entity("ent-a", "Alice"), entity("ent-b", "Bob")],
  });

  const matrix = buildRecommendationMatrixModel(ui);

  assert.equal(matrix.cells["src-one::ent-a"].state, "position");
  assert.equal(matrix.cells["src-one::ent-b"].state, "no-public-position");
  assert.equal(matrix.cells["src-one::ent-b"].positionKind, undefined);
  assert.equal(matrix.cells["src-one::ent-b"].positionKindLabel, "No public position");
  assert.deepEqual(matrix.cells["src-one::ent-b"].positionIds, []);
  assert.deepEqual(matrix.cells["src-one::ent-b"].evidenceIds, []);
  assert.equal(matrix.cells["src-two::ent-a"].state, "no-public-position");
});

test("builds source-type and position-kind filter metadata from visible cells", () => {
  const ui = buildRaceUiModel({
    race: publicRace({
      sourceIds: ["src-one", "src-two"],
      entityIds: ["ent-a", "ent-b"],
      positions: [
        position("pos-endorse", "src-one", "ent-a", "endorse", ["ev-one"]),
        position("pos-info", "src-one", "ent-b", "informational", ["ev-two"]),
        position("pos-oppose", "src-two", "ent-a", "oppose", ["ev-three"]),
      ],
    }),
    sources: [source("src-one", "Editorial", "editorial endorsements"), source("src-two", "Guide", "voter guides")],
    entities: [entity("ent-b", "Bob"), entity("ent-a", "Alice")],
  });

  const matrix = buildRecommendationMatrixModel(ui);

  assert.deepEqual(
    matrix.filters.sourceTypes.map((option) => ({ value: option.value, label: option.label, sourceCount: option.sourceCount, cellCount: option.cellCount })),
    [
      { value: "editorial endorsements", label: "editorial endorsements", sourceCount: 1, cellCount: 2 },
      { value: "voter guides", label: "voter guides", sourceCount: 1, cellCount: 2 },
    ],
  );
  assert.deepEqual(
    matrix.filters.positionKinds.map((option) => ({ value: option.value, label: option.label, cellCount: option.cellCount })),
    [
      { value: "endorse", label: "Endorse", cellCount: 1 },
      { value: "oppose", label: "Oppose", cellCount: 1 },
      { value: "informational", label: "Informational", cellCount: 1 },
      { value: "no-public-position", label: "No public position", cellCount: 1 },
    ],
  );
  assert.deepEqual(
    matrix.candidates.map((candidate) => candidate.name),
    ["Alice", "Bob"],
    "candidate columns are deterministically sorted by name",
  );
});

test("preserves evidence provenance and stable cell ids for later receipt drawers", () => {
  const ui = buildRaceUiModel({
    race: publicRace({
      sourceIds: ["src-one"],
      entityIds: ["ent-a"],
      positions: [position("pos-one", "src-one", "ent-a", "rank", ["ev-one", "ev-two"], { artifactId: "art-one", chunkId: "chunk-one" })],
    }),
    sources: [source("src-one", "Editorial", "editorial endorsements")],
    entities: [entity("ent-a", "Alice")],
  });

  const matrix = buildRecommendationMatrixModel(ui);
  const cell = matrix.cells["src-one::ent-a"];

  assert.equal(cell.id, "cell:src-one::ent-a");
  assert.equal(cell.positionKind, "rank");
  assert.equal(cell.positionKindLabel, "Ranked choice");
  assert.equal(cell.evidenceCount, 2);
  assert.deepEqual(
    cell.evidence.map((item) => ({ id: item.id, sourceId: item.sourceId, entityId: item.entityId, raceId: item.raceId, artifactId: item.artifactId, chunkId: item.chunkId, url: item.url })),
    [
      { id: "ev-one", sourceId: "src-one", entityId: "ent-a", raceId: "race-test", artifactId: "art-one", chunkId: "chunk-one", url: "https://example.com/ev-one" },
      { id: "ev-two", sourceId: "src-one", entityId: "ent-a", raceId: "race-test", artifactId: "art-one", chunkId: "chunk-one", url: "https://example.com/ev-two" },
    ],
  );
});

test("empty race produces an inspectable safe matrix state", () => {
  const ui = buildRaceUiModel({ race: publicRace({ sourceIds: [], entityIds: [], positions: [] }), sources: [], entities: [] });

  const matrix = buildRecommendationMatrixModel(ui);

  assert.equal(matrix.empty, true);
  assert.deepEqual(matrix.candidates, []);
  assert.deepEqual(matrix.sources, []);
  assert.deepEqual(matrix.groups, []);
  assert.deepEqual(matrix.cells, {});
  assert.deepEqual(matrix.filters.sourceTypes, []);
  assert.deepEqual(matrix.filters.positionKinds, []);
});

function publicRace(overrides: Partial<Race>): Race {
  return {
    id: "race-test",
    slug: "test-race",
    title: "Test Race",
    kind: "local-executive",
    status: "verified",
    publicationStatus: "public",
    electionDate: "2026-06-02",
    jurisdiction: "San Francisco",
    sourceIds: ["src-one"],
    entityIds: ["ent-a"],
    positions: [],
    ...overrides,
  };
}

function source(id: string, name: string, sourceType: string): Source {
  return {
    id,
    slug: id.replace(/^src-/, ""),
    name,
    category: "Fixture",
    sourceType,
    status: "active",
  };
}

function entity(id: string, name: string): Entity {
  return {
    id,
    slug: id.replace(/^ent-/, ""),
    name,
    kind: "candidate",
    status: "verified",
  };
}

function position(
  id: string,
  sourceId: string,
  entityId: string,
  kind: Race["positions"][number]["kind"],
  evidenceIds: string[],
  provenance: { artifactId?: string; chunkId?: string } = {},
): Race["positions"][number] {
  return {
    id,
    raceId: "race-test",
    sourceId,
    entityId,
    kind,
    status: "verified",
    publicationStatus: "public",
    label: `${kind} label`,
    evidenceIds,
    evidence: evidenceIds.map((evidenceId) => ({
      id: evidenceId,
      sourceId,
      entityId,
      raceId: "race-test",
      url: `https://example.com/${evidenceId}`,
      kind: "quote",
      quote: `${evidenceId} quote`,
      ...provenance,
    })),
  };
}
