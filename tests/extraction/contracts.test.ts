import test from "node:test";
import assert from "node:assert/strict";
import sourcesFile from "../../data/public/sources.json" with { type: "json" };
import entitiesFile from "../../data/public/entities.json" with { type: "json" };
import collectionsFile from "../../data/public/collections.json" with { type: "json" };
import mayorRaceFile from "../../data/public/races/mayor.json" with { type: "json" };
import artifact from "../../data/ingested/artifacts/src-sf-chronicle-mayor-sample.json" with { type: "json" };
import chunks from "../../data/ingested/chunks/src-sf-chronicle-mayor-sample.json" with { type: "json" };
import { validateExtractionDraft } from "../../lib/extraction/validate";
import type { PublicDataRepository } from "../../lib/data/types";
import type { ArtifactChunk, IngestedArtifact } from "../../lib/ingestion/types";
import type { ExtractionDraft, ExtractionValidationContext } from "../../lib/extraction/types";

const quote = "Candidate A is described in this sample as emphasizing faster housing approvals and clear performance goals for city departments.";

test("valid extraction draft bridges public race data to ingested artifact chunks", () => {
  const result = validateExtractionDraft(validDraft(), validationContext());

  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.positions, 1);
  assert.equal(result.counts.evidence, 1);
});

test("rejects malformed JSON-like provider output without throwing", () => {
  const result = validateExtractionDraft({ version: 2, runId: "", provider: "openai", positions: {}, evidence: null }, validationContext());

  assert.equal(result.ok, false);
  assertIssue(result.issues, "unsupported_version", "version");
  assertIssue(result.issues, "missing_run_id", "runId");
  assertIssue(result.issues, "invalid_provider", "provider");
  assertIssue(result.issues, "invalid_shape", "positions");
  assertIssue(result.issues, "invalid_shape", "evidence");
});

test("rejects empty positions and missing evidence references for public-ready drafts", () => {
  const draft = validDraft();
  draft.positions = [{ ...draft.positions[0], evidenceIds: [], publicReady: true, publicationStatus: "hidden" }];
  draft.evidence = [];

  const result = validateExtractionDraft(draft, validationContext());

  assertIssue(result.issues, "missing_evidence", "positions[0].evidenceIds");
});

test("rejects evidenceIds without matching evidence records", () => {
  const draft = validDraft();
  draft.positions[0].evidenceIds = ["ev-missing"];

  const result = validateExtractionDraft(draft, validationContext());

  assertIssue(result.issues, "missing_evidence_reference", "positions[0].evidenceIds[0]");
});

test("rejects nonexistent source, race, and entity references before review", () => {
  const draft = validDraft();
  draft.positions[0] = { ...draft.positions[0], raceId: "race-missing", sourceId: "src-missing", entityId: "ent-missing" };
  draft.evidence[0] = { ...draft.evidence[0], raceId: "race-missing", sourceId: "src-missing", entityId: "ent-missing" };

  const result = validateExtractionDraft(draft, validationContext());

  assertIssue(result.issues, "unknown_race_id", "positions[0].raceId");
  assertIssue(result.issues, "unknown_source_id", "positions[0].sourceId");
  assertIssue(result.issues, "unknown_entity_id", "positions[0].entityId");
  assertIssue(result.issues, "unknown_race_id", "evidence[0].raceId");
  assertIssue(result.issues, "unknown_source_id", "evidence[0].sourceId");
  assertIssue(result.issues, "unknown_entity_id", "evidence[0].entityId");
});

test("rejects duplicate position and evidence IDs", () => {
  const draft = validDraft();
  draft.positions.push({ ...draft.positions[0] });
  draft.evidence.push({ ...draft.evidence[0] });

  const result = validateExtractionDraft(draft, validationContext());

  assertIssue(result.issues, "duplicate_id", "positions[1].id");
  assertIssue(result.issues, "duplicate_id", "evidence[1].id");
});

test("rejects wrong enum values", () => {
  const draft = validDraft();
  draft.positions[0] = { ...draft.positions[0], kind: "maybe" as never, reviewStatus: "approved" as never, publicationStatus: "visible" as never };
  draft.evidence[0] = { ...draft.evidence[0], kind: "citation" as never };

  const result = validateExtractionDraft(draft, validationContext());

  assertIssue(result.issues, "unsupported_position_kind", "positions[0].kind");
  assertIssue(result.issues, "unsupported_review_status", "positions[0].reviewStatus");
  assertIssue(result.issues, "unsupported_publication_status", "positions[0].publicationStatus");
  assertIssue(result.issues, "unsupported_evidence_kind", "evidence[0].kind");
});

test("rejects missing artifact and chunk linkage", () => {
  const draft = validDraft();
  draft.evidence[0] = { ...draft.evidence[0], artifactId: "art-missing", chunkId: "chunk-missing" };

  const result = validateExtractionDraft(draft, validationContext());

  assertIssue(result.issues, "unknown_artifact_id", "evidence[0].artifactId");
  assertIssue(result.issues, "unknown_chunk_id", "evidence[0].chunkId");
});

test("rejects generated output trying to mark itself public without review", () => {
  const draft = validDraft();
  draft.positions[0] = { ...draft.positions[0], reviewStatus: "generated", publicationStatus: "public" };

  const result = validateExtractionDraft(draft, validationContext());

  assertIssue(result.issues, "unreviewed_publication", "positions[0].publicationStatus");
});

test("rejects missing evidence quote and quote text not found in referenced chunk", () => {
  const missingQuoteDraft = validDraft();
  missingQuoteDraft.evidence[0] = { ...missingQuoteDraft.evidence[0], quote: "" };
  const missingQuote = validateExtractionDraft(missingQuoteDraft, validationContext());
  assertIssue(missingQuote.issues, "missing_quote", "evidence[0].quote");

  const hallucinatedQuoteDraft = validDraft();
  hallucinatedQuoteDraft.evidence[0] = { ...hallucinatedQuoteDraft.evidence[0], quote: "This sentence does not appear in the chunk." };
  const hallucinatedQuote = validateExtractionDraft(hallucinatedQuoteDraft, validationContext());
  assertIssue(hallucinatedQuote.issues, "quote_not_in_chunk", "evidence[0].quote");
});

function validDraft(): ExtractionDraft {
  return {
    version: 1,
    runId: "run-s04-contract-test",
    provider: { provider: "test-provider", model: "test-model" },
    positions: [
      {
        id: "pos-draft-chronicle-candidate-a",
        raceId: "race-mayor",
        sourceId: "src-sf-chronicle",
        entityId: "ent-sample-candidate-a",
        kind: "endorse",
        reviewStatus: "generated",
        publicationStatus: "hidden",
        label: "Draft extracted endorsement for Candidate A",
        rationale: "Candidate A is described as emphasizing faster housing approvals.",
        evidenceIds: ["ev-draft-chronicle-candidate-a"],
      },
    ],
    evidence: [
      {
        id: "ev-draft-chronicle-candidate-a",
        positionId: "pos-draft-chronicle-candidate-a",
        raceId: "race-mayor",
        sourceId: "src-sf-chronicle",
        entityId: "ent-sample-candidate-a",
        artifactId: "art-sf-chronicle-mayor-sample",
        chunkId: "art-sf-chronicle-mayor-sample-chunk-001",
        url: "https://www.sfchronicle.com/projects/2026/sample-voter-guide/mayor",
        kind: "quote",
        quote,
      },
    ],
  };
}

function validationContext(): ExtractionValidationContext {
  return {
    publicData: {
      sources: sourcesFile.sources,
      entities: entitiesFile.entities,
      collections: collectionsFile.collections,
      races: [mayorRaceFile.race],
    } as PublicDataRepository,
    artifacts: [artifact as IngestedArtifact],
    chunks: chunks as ArtifactChunk[],
    checkedFiles: [
      "data/public/races/mayor.json",
      "data/ingested/artifacts/src-sf-chronicle-mayor-sample.json",
      "data/ingested/chunks/src-sf-chronicle-mayor-sample.json",
    ],
  };
}

function assertIssue(issues: { code: string; path: string }[], code: string, path: string): void {
  assert.equal(
    issues.some((issue) => issue.code === code && issue.path === path),
    true,
    `Expected issue ${code} at ${path}; got ${JSON.stringify(issues, null, 2)}`,
  );
}
