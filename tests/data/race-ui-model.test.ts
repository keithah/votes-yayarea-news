import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataLoadError, loadPublicRaceContext } from "../../lib/data/loaders";
import type { Race, Source, Entity } from "../../lib/data/types";
import { buildRaceUiModel } from "../../lib/ui/race";

test("builds sample mayor race model from public loader output only", async () => {
  const context = await loadPublicRaceContext("mayor");

  assert.ok(context);
  const model = buildRaceUiModel(context);

  assert.equal(model.race.slug, "mayor");
  assert.equal(model.sourceCount, 2);
  assert.equal(model.evidenceCount, 2);
  assert.deepEqual(
    model.candidates.map((candidate) => ({ id: candidate.id, positionCount: candidate.positionCount, evidenceCount: candidate.evidenceCount, sourceCount: candidate.sourceCount })),
    [
      { id: "ent-sample-candidate-a", positionCount: 1, evidenceCount: 1, sourceCount: 1 },
      { id: "ent-sample-candidate-b", positionCount: 1, evidenceCount: 1, sourceCount: 1 },
    ],
  );
  assert.equal(model.candidates[0].countsByKind.endorse, 1, "duplicate same-source endorsements should not inflate consensus counts");
  assert.equal(model.candidates[1].countsByKind.informational, 1);
  assert.equal(model.consensus.entityId, "ent-sample-candidate-a");
  assert.equal(model.consensus.count, 1);
  assert.equal(model.consensus.sourceCount, 2);
  assert.equal(model.consensus.percentage, 50);
  assert.equal(model.summary.visible, false, "hidden draft summaries must not surface in the public UI model");
  assert.equal(model.placeholders.matrixReady, true);
  assert.equal(model.placeholders.receiptsReady, true);
  assert.equal(model.placeholders.aiDisclosureReady, true);
});

test("unknown and non-public races do not produce a UI model context", async () => {
  assert.equal(await loadPublicRaceContext("missing-race"), null);

  const fixture = await createFixture();
  assert.equal(await loadPublicRaceContext("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }), null);
});

test("empty public positions produce zeroed counts and safe placeholders", () => {
  const model = buildRaceUiModel({ race: publicRace({ positions: [], sourceIds: [], entityIds: [] }), sources: [], entities: [] });

  assert.equal(model.sourceCount, 0);
  assert.equal(model.evidenceCount, 0);
  assert.deepEqual(model.positions, []);
  assert.equal(model.consensus.label, "No public sources");
  assert.equal(model.consensus.percentage, 0);
  assert.equal(model.placeholders.hasPublicPositions, false);
  assert.equal(model.placeholders.matrixReady, false);
  assert.equal(model.placeholders.receiptsReady, false);
});

test("malformed public references fail validation before UI model construction", async () => {
  const fixture = await createFixture();
  await writeOverride(fixture.overridesDir, {
    race: {
      status: "verified",
      publicationStatus: "public",
      positions: [
        {
          id: "pos-chronicle-candidate-a",
          status: "verified",
          publicationStatus: "public",
          sourceId: "src-missing",
        },
      ],
    },
  });

  await assert.rejects(
    () => loadPublicRaceContext("mayor", { publicDir: fixture.publicDir, overridesDir: fixture.overridesDir }),
    (error: unknown) => {
      assert.ok(error instanceof DataLoadError);
      assert.equal(error.phase, "merged");
      assert.equal(error.slug, "mayor");
      assert.ok(error.issues.some((issue) => issue.code === "missing_reference" && issue.path.includes("sourceId")));
      return true;
    },
  );
});

test("groups source-type breakdown by source metadata", () => {
  const sources: Source[] = [source("src-one", "voter guide"), source("src-two", "voter guide"), source("src-three", "editorial")];
  const entities: Entity[] = [entity("ent-a")];
  const race = publicRace({
    sourceIds: sources.map((item) => item.id),
    entityIds: ["ent-a"],
    positions: [
      position("pos-one", "src-one", "ent-a", "endorse", ["ev-one"]),
      position("pos-two", "src-two", "ent-a", "oppose", ["ev-two", "ev-three"]),
    ],
  });

  const model = buildRaceUiModel({ race, sources, entities });

  assert.deepEqual(model.sourceTypeBreakdown, [
    { sourceType: "editorial", sourceCount: 1, positionCount: 0, evidenceCount: 0 },
    { sourceType: "voter guide", sourceCount: 2, positionCount: 2, evidenceCount: 3 },
  ]);
});

test("preserves evidence provenance for receipts and later drill-down surfaces", () => {
  const evidenceIds = ["ev-provenance"];
  const race = publicRace({
    sourceIds: ["src-one"],
    entityIds: ["ent-a"],
    positions: [position("pos-one", "src-one", "ent-a", "endorse", evidenceIds, { artifactId: "art-one", chunkId: "chunk-one" })],
  });

  const model = buildRaceUiModel({ race, sources: [source("src-one", "editorial")], entities: [entity("ent-a")] });

  assert.equal(model.positions[0].evidence[0].artifactId, "art-one");
  assert.equal(model.positions[0].evidence[0].chunkId, "chunk-one");
  assert.equal(model.placeholders.receiptsReady, true);
});

async function createFixture(): Promise<{ publicDir: string; overridesDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-race-ui-"));
  const publicDir = path.join(root, "data", "public");
  const overridesDir = path.join(root, "manual", "overrides");
  await fs.cp(path.join(process.cwd(), "data", "public"), publicDir, { recursive: true });
  return { publicDir, overridesDir };
}

async function writeOverride(overridesDir: string, value: unknown): Promise<void> {
  await fs.mkdir(path.join(overridesDir, "races"), { recursive: true });
  await fs.writeFile(path.join(overridesDir, "races", "mayor.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

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

function source(id: string, sourceType: string): Source {
  return {
    id,
    slug: id.replace(/^src-/, ""),
    name: id,
    category: "Fixture",
    sourceType,
    status: "active",
  };
}

function entity(id: string): Entity {
  return {
    id,
    slug: id.replace(/^ent-/, ""),
    name: id,
    kind: "candidate",
    status: "verified",
  };
}

function position(id: string, sourceId: string, entityId: string, kind: Race["positions"][number]["kind"], evidenceIds: string[], provenance: { artifactId?: string; chunkId?: string } = {}): Race["positions"][number] {
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
