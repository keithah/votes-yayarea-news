import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicData, validatePublicDataFiles } from "../../lib/data/validate";
import type { PublicDataRepository } from "../../lib/data/types";

test("canonical public data validates", async () => {
  const result = await validatePublicDataFiles();
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.sources, 24);
  assert.equal(result.counts.entities, 139);
  assert.equal(result.counts.collections, 4);
  assert.equal(result.counts.races, 21);
  assert.equal(result.counts.positions, 61);
  assert.equal(result.counts.evidence, 61);
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
        id: "src-ca-secretary-of-state",
        slug: "california-secretary-of-state",
        name: "California Secretary of State",
        category: "Official election administration",
        sourceType: "official certified candidate list",
        status: "active",
        guideUrl: "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf",
      },
      {
        id: "src-sf-department-of-elections",
        slug: "san-francisco-department-of-elections",
        name: "San Francisco Department of Elections",
        category: "Official election administration",
        sourceType: "official local election records",
        status: "active",
        homepageUrl: "https://www.sf.gov/departments/department-elections",
      },
    ],
    entities: [
      {
        id: "ent-california-governor-akinyemi-agbede",
        slug: "california-governor-akinyemi-agbede",
        name: "Akinyemi Agbede",
        kind: "candidate",
        status: "verified",
      },
      {
        id: "ent-california-governor-mohammad-arif",
        slug: "california-governor-mohammad-arif",
        name: "Mohammad Arif",
        kind: "candidate",
        status: "verified",
      },
    ],
    collections: [
      {
        id: "col-launch-races",
        slug: "launch-races",
        title: "Launch races",
        kind: "race",
        status: "verified",
        raceIds: ["race-california-governor"],
      },
    ],
    races: [
      {
        id: "race-california-governor",
        slug: "california-governor",
        title: "California Governor",
        kind: "statewide-executive",
        status: "verified",
        publicationStatus: "public",
        electionDate: "2026-06-02",
        jurisdiction: "California",
        entityIds: ["ent-california-governor-akinyemi-agbede", "ent-california-governor-mohammad-arif"],
        sourceIds: ["src-ca-secretary-of-state"],
        positions: [
          {
            id: "pos-sos-governor-akinyemi-agbede",
            raceId: "race-california-governor",
            sourceId: "src-ca-secretary-of-state",
            entityId: "ent-california-governor-akinyemi-agbede",
            kind: "informational",
            status: "verified",
            publicationStatus: "public",
            label: "Official certified candidate listing",
            evidenceIds: ["ev-sos-governor-akinyemi-agbede"],
            evidence: [
              {
                id: "ev-sos-governor-akinyemi-agbede",
                sourceId: "src-ca-secretary-of-state",
                entityId: "ent-california-governor-akinyemi-agbede",
                raceId: "race-california-governor",
                url: "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf",
                kind: "link",
                quote: "Democratic candidate listed by the California Secretary of State for California Governor in the official certified candidate list.",
              },
            ],
          },
        ],
      },
    ],
  };
}
