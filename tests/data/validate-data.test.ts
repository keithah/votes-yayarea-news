import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicData, validatePublicDataFiles } from "../../lib/data/validate";
import type { PublicDataRepository } from "../../lib/data/types";

test("canonical public sample data validates", async () => {
  const result = await validatePublicDataFiles();
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.sources, 2);
  assert.equal(result.counts.entities, 2);
  assert.equal(result.counts.collections, 1);
  assert.equal(result.counts.races, 1);
  assert.equal(result.counts.positions, 2);
  assert.equal(result.counts.evidence, 2);
});

test("rejects malformed evidence URL", () => {
  const repository = validRepository();
  repository.races[0].positions[0].evidence[0].url = "not a url";

  const result = validatePublicData(repository);

  assertIssue(result.issues, "invalid_url", "races[0].positions[0].evidence[0].url");
});

test("rejects duplicate IDs and slugs", () => {
  const repository = validRepository();
  repository.sources.push({ ...repository.sources[0] });
  repository.entities.push({ ...repository.entities[0], id: "ent-sample-candidate-c" });

  const result = validatePublicData(repository);

  assertIssue(result.issues, "duplicate_id", "sources[2].id");
  assertIssue(result.issues, "duplicate_id", "sources[2].slug");
  assertIssue(result.issues, "duplicate_id", "entities[2].slug");
});

test("rejects missing entity and source references", () => {
  const repository = validRepository();
  repository.races[0].sourceIds = ["src-missing"];
  repository.races[0].positions[0].entityId = "ent-missing";

  const result = validatePublicData(repository);

  assertIssue(result.issues, "missing_reference", "races[0].sourceIds[0]");
  assertIssue(result.issues, "missing_reference", "races[0].positions[0].entityId");
});

test("rejects unsupported statuses", () => {
  const repository = validRepository();
  repository.races[0].positions[0].status = "approved" as never;

  const result = validatePublicData(repository);

  assertIssue(result.issues, "unsupported_status", "races[0].positions[0].status");
});

test("rejects visible recommendations without evidence", () => {
  const repository = validRepository();
  repository.races[0].positions[0].evidence = [];
  repository.races[0].positions[0].evidenceIds = [];

  const result = validatePublicData(repository);

  assertIssue(result.issues, "missing_evidence", "races[0].positions[0].evidence");
});

test("rejects empty required strings", () => {
  const repository = validRepository();
  repository.entities[0].name = " ";

  const result = validatePublicData(repository);

  assertIssue(result.issues, "required_string", "entities[0].name");
});

function assertIssue(issues: { code: string; path: string }[], code: string, path: string): void {
  assert.ok(
    issues.some((issue) => issue.code === code && issue.path === path),
    `Expected issue ${code} at ${path}; got ${JSON.stringify(issues)}`,
  );
}

function validRepository(): PublicDataRepository {
  return {
    sources: [
      {
        id: "src-sf-chronicle",
        slug: "san-francisco-chronicle-editorial-board",
        name: "San Francisco Chronicle Editorial Board",
        category: "Media / Editorial",
        sourceType: "editorial endorsements",
        status: "pending",
        guideUrl: "https://www.sfchronicle.com/projects/2026/sample-voter-guide",
        sampleFixture: true,
      },
      {
        id: "src-growsf",
        slug: "growsf-voter-guide",
        name: "GrowSF Voter Guide",
        category: "Civic / Nonpartisan",
        sourceType: "civic voter guide / recommendations",
        status: "pending",
        guideUrl: "https://growsf.org/voter-guide/sample-2026",
        sampleFixture: true,
      },
    ],
    entities: [
      {
        id: "ent-sample-candidate-a",
        slug: "sample-candidate-a",
        name: "Sample Candidate A",
        kind: "candidate",
        status: "draft",
        sampleFixture: true,
      },
      {
        id: "ent-sample-candidate-b",
        slug: "sample-candidate-b",
        name: "Sample Candidate B",
        kind: "candidate",
        status: "draft",
        sampleFixture: true,
      },
    ],
    collections: [
      {
        id: "col-launch-races",
        slug: "launch-races",
        title: "Launch races",
        kind: "race",
        status: "draft",
        raceIds: ["race-mayor"],
      },
    ],
    races: [
      {
        id: "race-mayor",
        slug: "mayor",
        title: "San Francisco Mayor",
        kind: "local-executive",
        status: "draft",
        publicationStatus: "hidden",
        electionDate: "2026-06-02",
        jurisdiction: "San Francisco",
        entityIds: ["ent-sample-candidate-a", "ent-sample-candidate-b"],
        sourceIds: ["src-sf-chronicle", "src-growsf"],
        sampleFixture: true,
        positions: [
          {
            id: "pos-chronicle-candidate-a",
            raceId: "race-mayor",
            sourceId: "src-sf-chronicle",
            entityId: "ent-sample-candidate-a",
            kind: "endorse",
            status: "reviewed",
            publicationStatus: "public",
            label: "Sample endorsement for Candidate A",
            evidenceIds: ["ev-chronicle-candidate-a"],
            evidence: [
              {
                id: "ev-chronicle-candidate-a",
                sourceId: "src-sf-chronicle",
                entityId: "ent-sample-candidate-a",
                raceId: "race-mayor",
                url: "https://www.sfchronicle.com/projects/2026/sample-voter-guide/mayor",
                kind: "quote",
                quote: "Sample fixture quote.",
              },
            ],
          },
        ],
      },
    ],
  };
}
