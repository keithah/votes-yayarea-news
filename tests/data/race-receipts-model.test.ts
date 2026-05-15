import test from "node:test";
import assert from "node:assert/strict";
import type { Entity, Race, Source } from "../../lib/data/types";
import { buildRaceReceiptsModel, buildRaceReviewedSummaryModel, buildRaceUiModel, buildRecommendationMatrixModel } from "../../lib/ui/race";

test("builds stable public receipt models keyed by recommendation matrix cell id", () => {
  const ui = buildRaceUiModel({
    race: publicRace({
      sourceIds: ["src-one"],
      entityIds: ["ent-a"],
      positions: [position("pos-one", "src-one", "ent-a", "endorse", ["ev-one"], { artifactId: "art-one", chunkId: "chunk-one" })],
    }),
    sources: [source("src-one", "Editorial Board", "editorial endorsements")],
    entities: [entity("ent-a", "Alice")],
  });
  const matrix = buildRecommendationMatrixModel(ui);

  const receipts = buildRaceReceiptsModel(ui, matrix);
  const receipt = receipts.byCellId["cell:src-one::ent-a"];

  assert.equal(receipts.raceId, "race-test");
  assert.equal(receipts.raceSlug, "test-race");
  assert.equal(receipts.receiptCount, 1);
  assert.equal(receipts.availableCount, 1);
  assert.equal(receipt.cellId, "cell:src-one::ent-a");
  assert.equal(receipt.status, "available");
  assert.equal(receipt.source.id, "src-one");
  assert.equal(receipt.source.label, "Editorial Board");
  assert.equal(receipt.candidate.id, "ent-a");
  assert.equal(receipt.candidate.label, "Alice");
  assert.equal(receipt.position.kind, "endorse");
  assert.equal(receipt.position.label, "endorse label");
  assert.deepEqual(receipt.positionIds, ["pos-one"]);
  assert.deepEqual(receipt.evidenceIds, ["ev-one"]);
  assert.equal(receipt.evidence[0].id, "ev-one");
  assert.equal(receipt.evidence[0].quote, "ev-one quote");
  assert.equal(receipt.evidence[0].url, "https://example.com/ev-one");
  assert.equal(receipt.evidence[0].source.id, "src-one");
  assert.equal(receipt.evidence[0].source.label, "Editorial Board");
  assert.equal(receipt.evidence[0].candidate?.id, "ent-a");
  assert.equal(receipt.evidence[0].candidate?.label, "Alice");
  assert.equal(receipt.evidence[0].position.kind, "endorse");
  assert.equal(receipt.evidence[0].position.label, "endorse label");
  assert.equal(receipt.evidence[0].publicationStatus, "public");
  assert.equal(receipt.evidence[0].reviewStatus, "verified");
  assert.equal(receipt.evidence[0].artifactId, "art-one");
  assert.equal(receipt.evidence[0].chunkId, "chunk-one");
  assert.doesNotThrow(() => JSON.stringify(receipts));
});

test("represents no-public-position matrix cells as unavailable receipts without fabricated quote or link", () => {
  const ui = buildRaceUiModel({
    race: publicRace({ sourceIds: ["src-one"], entityIds: ["ent-a", "ent-b"], positions: [position("pos-one", "src-one", "ent-a", "endorse", ["ev-one"])] }),
    sources: [source("src-one", "Editorial Board", "editorial endorsements")],
    entities: [entity("ent-a", "Alice"), entity("ent-b", "Bob")],
  });
  const matrix = buildRecommendationMatrixModel(ui);

  const receipts = buildRaceReceiptsModel(ui, matrix);
  const unavailable = receipts.byCellId["cell:src-one::ent-b"];

  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.emptyReason, "no-public-position");
  assert.equal(unavailable.position.kind, undefined);
  assert.equal(unavailable.position.label, "No public position");
  assert.deepEqual(unavailable.positionIds, []);
  assert.deepEqual(unavailable.evidenceIds, []);
  assert.deepEqual(unavailable.evidence, []);
  assert.equal(receipts.availableCount, 1);
  assert.equal(receipts.unavailableCount, 1);
});

test("builds reviewed summary evidence support from public evidence ids", () => {
  const race = publicRace({
    sourceIds: ["src-one", "src-two"],
    entityIds: ["ent-a", "ent-b"],
    positions: [position("pos-one", "src-one", "ent-a", "endorse", ["ev-one"]), position("pos-two", "src-two", "ent-b", "informational", ["ev-two"])],
    summary: {
      id: "sum-one",
      status: "reviewed",
      publicationStatus: "public",
      text: "Reviewed public summary.",
      evidenceIds: ["ev-two", "ev-one"],
    },
  });
  const ui = buildRaceUiModel({ race, sources: [source("src-one", "Editorial Board", "editorial endorsements"), source("src-two", "Voter Guide", "voter guides")], entities: [entity("ent-a", "Alice"), entity("ent-b", "Bob")] });

  const summary = buildRaceReviewedSummaryModel(ui);

  assert.equal(summary.visible, true);
  assert.equal(summary.status, "available");
  assert.equal(summary.summaryId, "sum-one");
  assert.equal(summary.text, "Reviewed public summary.");
  assert.deepEqual(summary.evidenceIds, ["ev-two", "ev-one"]);
  assert.equal(summary.evidenceCount, 2);
  assert.deepEqual(
    summary.evidence.map((item) => ({ id: item.id, quote: item.quote, source: item.source.label, candidate: item.candidate?.label, positionKind: item.position.kind, positionLabel: item.position.label })),
    [
      { id: "ev-two", quote: "ev-two quote", source: "Voter Guide", candidate: "Bob", positionKind: "informational", positionLabel: "informational label" },
      { id: "ev-one", quote: "ev-one quote", source: "Editorial Board", candidate: "Alice", positionKind: "endorse", positionLabel: "endorse label" },
    ],
  );
  assert.doesNotThrow(() => JSON.stringify(summary));
});

test("returns unavailable summary support for missing, hidden, or malformed public evidence ids", () => {
  const ui = buildRaceUiModel({
    race: publicRace({
      positions: [position("pos-one", "src-one", "ent-a", "endorse", ["ev-one"])],
      summary: {
        id: "sum-one",
        status: "reviewed",
        publicationStatus: "public",
        text: "Reviewed public summary with malformed support.",
        evidenceIds: ["ev-missing"],
      },
    }),
    sources: [source("src-one", "Editorial Board", "editorial endorsements")],
    entities: [entity("ent-a", "Alice")],
  });

  const summary = buildRaceReviewedSummaryModel(ui);

  assert.equal(summary.visible, true);
  assert.equal(summary.status, "unavailable");
  assert.equal(summary.emptyReason, "no-public-evidence");
  assert.deepEqual(summary.evidenceIds, ["ev-missing"]);
  assert.equal(summary.evidenceCount, 0);
  assert.deepEqual(summary.evidence, []);
});

test("empty public positions produce serializable empty receipt and summary support models", () => {
  const ui = buildRaceUiModel({ race: publicRace({ sourceIds: [], entityIds: [], positions: [] }), sources: [], entities: [] });
  const matrix = buildRecommendationMatrixModel(ui);

  const receipts = buildRaceReceiptsModel(ui, matrix);
  const summary = buildRaceReviewedSummaryModel(ui);

  assert.equal(receipts.empty, true);
  assert.equal(receipts.receiptCount, 0);
  assert.deepEqual(receipts.byCellId, {});
  assert.equal(summary.visible, false);
  assert.equal(summary.status, "unavailable");
  assert.equal(summary.emptyReason, "no-reviewed-summary");
  assert.deepEqual(summary.evidence, []);
  assert.doesNotThrow(() => JSON.stringify({ receipts, summary }));
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
