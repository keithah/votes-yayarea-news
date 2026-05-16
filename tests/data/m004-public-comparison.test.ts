import test from "node:test";
import assert from "node:assert/strict";
import { buildRacePageModel } from "../../app/races/[slug]/page";
import { loadPublicRaceContext } from "../../lib/data/loaders";

const SOS_SOURCE_ID = "src-ca-secretary-of-state";
const GROWSF_SOURCE_ID = "src-growsf";
const CHRONICLE_SOURCE_ID = "src-sf-chronicle";

const STATE_ASSEMBLY_17 = "state-assembly-district-17";
const GOVERNOR = "california-governor";
const US_HOUSE_11 = "us-house-district-11";

const STATE_ASSEMBLY_HANEY_ENTITY_ID = "ent-state-assembly-district-17-matt-haney";
const GOVERNOR_KATIE_PORTER_ENTITY_ID = "ent-california-governor-katie-porter";
const GOVERNOR_MATT_MAHAN_ENTITY_ID = "ent-california-governor-matt-mahan";
const US_HOUSE_SCOTT_WIENER_ENTITY_ID = "ent-us-house-district-11-scott-wiener";

const STATE_ASSEMBLY_SOS_POSITION_ID = "pos-m004-s02-sos-state-assembly-district-17-matt-haney-informational";
const STATE_ASSEMBLY_DUPLICATE_POSITION_ID = "pos-m004-s02-sos-state-assembly-district-17-matt-haney-informational-duplicate";
const STATE_ASSEMBLY_GROWSF_POSITION_ID = "pos-m004-s02-growsf-state-assembly-district-17-matt-haney";
const GOVERNOR_CHRONICLE_POSITION_ID = "pos-m004-s02-chronicle-governor-katie-porter";
const GOVERNOR_GROWSF_HIDDEN_POSITION_ID = "pos-m004-s02-growsf-governor-matt-mahan-hidden";
const US_HOUSE_GROWSF_POSITION_ID = "pos-m004-s02-growsf-us-house-district-11-scott-wiener";

test("M004 State Assembly District 17 page model exposes Secretary of State coverage and GrowSF endorsement", async () => {
  const context = await loadPublicRaceContext(STATE_ASSEMBLY_17);
  assert.ok(context, `${STATE_ASSEMBLY_17}: expected a public race context.`);
  assertPublicPosition(context.race.positions, STATE_ASSEMBLY_SOS_POSITION_ID, {
    slug: STATE_ASSEMBLY_17,
    sourceId: SOS_SOURCE_ID,
    entityId: STATE_ASSEMBLY_HANEY_ENTITY_ID,
    kind: "informational",
  });
  assertPublicPosition(context.race.positions, STATE_ASSEMBLY_GROWSF_POSITION_ID, {
    slug: STATE_ASSEMBLY_17,
    sourceId: GROWSF_SOURCE_ID,
    entityId: STATE_ASSEMBLY_HANEY_ENTITY_ID,
    kind: "endorse",
  });
  assertNoPositionId(context.race.positions, STATE_ASSEMBLY_DUPLICATE_POSITION_ID, `${STATE_ASSEMBLY_17}: duplicate public claim must remain hidden/non-public.`);

  const model = await buildRacePageModel(STATE_ASSEMBLY_17);
  assert.ok(model, `${STATE_ASSEMBLY_17}: expected a public race page model.`);
  assert.equal(model.diagnostics.hasManualOverride, true, `${STATE_ASSEMBLY_17}: expected S02 manual override to be loaded.`);
  assert.ok(model.diagnostics.publicSourceCount >= 2, `${STATE_ASSEMBLY_17}: expected at least two public sources after S02 publication.`);
  assert.ok(model.diagnostics.publicPositionCount >= 2, `${STATE_ASSEMBLY_17}: expected at least two public positions after S02 publication.`);
  assert.ok(model.diagnostics.matrixSourceCount >= 2, `${STATE_ASSEMBLY_17}: expected matrix to include SOS and GrowSF sources.`);
  assert.equal(model.matrix.cells[`${SOS_SOURCE_ID}::${STATE_ASSEMBLY_HANEY_ENTITY_ID}`]?.state, "position");
  assert.equal(model.matrix.cells[`${SOS_SOURCE_ID}::${STATE_ASSEMBLY_HANEY_ENTITY_ID}`]?.positionKind, "informational");
  assert.equal(model.matrix.cells[`${GROWSF_SOURCE_ID}::${STATE_ASSEMBLY_HANEY_ENTITY_ID}`]?.state, "position");
  assert.equal(model.matrix.cells[`${GROWSF_SOURCE_ID}::${STATE_ASSEMBLY_HANEY_ENTITY_ID}`]?.positionKind, "endorse");
});

test("M004 California Governor page model keeps Chronicle publication and honest empty cells", async () => {
  const context = await loadPublicRaceContext(GOVERNOR);
  assert.ok(context, `${GOVERNOR}: expected a public race context.`);
  assertPublicPosition(context.race.positions, GOVERNOR_CHRONICLE_POSITION_ID, {
    slug: GOVERNOR,
    sourceId: CHRONICLE_SOURCE_ID,
    entityId: GOVERNOR_KATIE_PORTER_ENTITY_ID,
    kind: "endorse",
  });
  assertNoPositionId(context.race.positions, GOVERNOR_GROWSF_HIDDEN_POSITION_ID, `${GOVERNOR}: not-requested GrowSF governor claim must remain hidden/non-public.`);

  const model = await buildRacePageModel(GOVERNOR);
  assert.ok(model, `${GOVERNOR}: expected a public race page model.`);
  assert.ok(model.diagnostics.matrixSourceCount >= 2, `${GOVERNOR}: expected at least two matrix sources after Chronicle publication.`);
  assert.ok(model.diagnostics.matrixCellCount > model.diagnostics.availableReceiptCount, `${GOVERNOR}: expected some matrix cells without public positions.`);
  assert.equal(model.matrix.cells[`${CHRONICLE_SOURCE_ID}::${GOVERNOR_KATIE_PORTER_ENTITY_ID}`]?.state, "position");
  assert.equal(model.matrix.cells[`${CHRONICLE_SOURCE_ID}::${GOVERNOR_KATIE_PORTER_ENTITY_ID}`]?.positionKind, "endorse");

  const hiddenGrowSfCell = model.matrix.cells[`${GROWSF_SOURCE_ID}::${GOVERNOR_MATT_MAHAN_ENTITY_ID}`];
  assert.ok(hiddenGrowSfCell, `${GOVERNOR}: expected a GrowSF/Matt Mahan cell so hidden claims are visibly empty, not absent.`);
  assert.equal(hiddenGrowSfCell.state, "no-public-position", `${GOVERNOR}: hidden GrowSF/Matt Mahan claim must not fabricate a public endorsement.`);
  assert.deepEqual(hiddenGrowSfCell.positionIds, []);
  assert.equal(model.receipts.byCellId[hiddenGrowSfCell.id]?.status, "unavailable");
  assert.equal(model.receipts.byCellId[hiddenGrowSfCell.id]?.emptyReason, "no-public-position");
});

test("M004 US House District 11 page model exposes GrowSF Scott Wiener public position once mapped", async () => {
  const context = await loadPublicRaceContext(US_HOUSE_11);
  assert.ok(context, `${US_HOUSE_11}: expected a public race context.`);
  assertPublicPosition(context.race.positions, US_HOUSE_GROWSF_POSITION_ID, {
    slug: US_HOUSE_11,
    sourceId: GROWSF_SOURCE_ID,
    entityId: US_HOUSE_SCOTT_WIENER_ENTITY_ID,
    kind: "endorse",
  });

  const model = await buildRacePageModel(US_HOUSE_11);
  assert.ok(model, `${US_HOUSE_11}: expected a public race page model.`);
  assert.ok(model.diagnostics.publicSourceCount >= 2, `${US_HOUSE_11}: expected GrowSF plus official informational coverage.`);
  assert.ok(model.diagnostics.availableReceiptCount >= 1, `${US_HOUSE_11}: expected GrowSF evidence receipt to be available.`);
  assert.equal(model.matrix.cells[`${GROWSF_SOURCE_ID}::${US_HOUSE_SCOTT_WIENER_ENTITY_ID}`]?.state, "position");
  assert.equal(model.matrix.cells[`${GROWSF_SOURCE_ID}::${US_HOUSE_SCOTT_WIENER_ENTITY_ID}`]?.positionKind, "endorse");
});

function assertPublicPosition(
  positions: Array<{ id: string; sourceId: string; entityId: string; kind: string; publicationStatus?: string; status: string; evidenceIds: string[]; evidence: unknown[] }>,
  positionId: string,
  expected: { slug: string; sourceId: string; entityId: string; kind: string },
): void {
  const position = positions.find((candidate) => candidate.id === positionId);
  assert.ok(position, `${expected.slug}: missing public position ${positionId}.`);
  assert.equal(position.sourceId, expected.sourceId, `${expected.slug}: ${positionId} source mismatch.`);
  assert.equal(position.entityId, expected.entityId, `${expected.slug}: ${positionId} entity mismatch.`);
  assert.equal(position.kind, expected.kind, `${expected.slug}: ${positionId} kind mismatch.`);
  assert.equal(position.publicationStatus, "public", `${expected.slug}: ${positionId} must be public.`);
  assert.match(position.status, /^(verified|published)$/, `${expected.slug}: ${positionId} must have a public review status.`);
  assert.ok(position.evidenceIds.length > 0, `${expected.slug}: ${positionId} needs evidenceIds.`);
  assert.ok(position.evidence.length > 0, `${expected.slug}: ${positionId} needs public evidence.`);
}

function assertNoPositionId(positions: Array<{ id: string }>, positionId: string, message: string): void {
  assert.equal(positions.some((position) => position.id === positionId), false, message);
}
