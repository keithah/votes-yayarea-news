import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPublicRaceData } from "../../lib/data/loaders";
import type { Position, Race } from "../../lib/data/types";

const DIAGNOSTICS_PATH = "data/reviewed/m004-s02-bulk-latest.json";
const PUBLIC_DIR = "data/public";
const OVERRIDES_DIR = "manual/overrides";
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+)/i;
const PUBLIC_STATUSES = new Set(["verified", "published"]);
const HIDDEN_UNSAFE_REASON_CODES = new Set(["duplicate_public_claim", "not_requested_public"]);
const REPAIRABLE_REJECTED_REASON_CODES = new Set(["source_not_in_race"]);

test("M004 S02 generated bulk diagnostics, overrides, and public loader agree", async () => {
  const result = await assertM004PublicationGate({ diagnosticsPath: DIAGNOSTICS_PATH, publicDir: PUBLIC_DIR, overridesDir: OVERRIDES_DIR });

  assert.ok(result.publicPositions.length >= 1, "Expected at least one loader-visible public position from M004 S02 overrides.");
  assert.equal(result.publicPositions.length, result.diagnostics.counts.published, "Loader-visible public positions should match diagnostics published count.");
});

test("M004 S02 publication gate fails with an actionable path for missing diagnostics", async () => {
  await assert.rejects(
    () => assertM004PublicationGate({ diagnosticsPath: "data/reviewed/does-not-exist.json", publicDir: PUBLIC_DIR, overridesDir: OVERRIDES_DIR }),
    /Missing diagnostics at data\/reviewed\/does-not-exist\.json/,
  );
});

test("M004 S02 publication gate rejects empty diagnostics", async () => {
  const fixture = await createArtifactFixture();
  await fs.writeFile(fixture.diagnosticsPath, "{}\n", "utf8");

  await assert.rejects(
    () => assertM004PublicationGate({ diagnosticsPath: fixture.diagnosticsPath, publicDir: PUBLIC_DIR, overridesDir: fixture.overridesDir }),
    /diagnostics\.ok must be boolean|diagnostics\.counts\.published must be a number/,
  );
});

test("M004 S02 publication gate rejects unsupported public status", async () => {
  const fixture = await createArtifactFixture();
  const override = await readJson<{ race: Race }>(fixture.overridePath);
  override.race.positions[0].status = "reviewed" as Position["status"];
  await writeJson(fixture.overridePath, override);

  await assert.rejects(
    () => assertM004PublicationGate({ diagnosticsPath: fixture.diagnosticsPath, publicDir: PUBLIC_DIR, overridesDir: fixture.overridesDir }),
    /unsupported public status/,
  );
});

test("M004 S02 publication gate rejects public records without evidence", async () => {
  const fixture = await createArtifactFixture();
  const override = await readJson<{ race: Race }>(fixture.overridePath);
  override.race.positions[0].evidenceIds = [];
  override.race.positions[0].evidence = [];
  await writeJson(fixture.overridePath, override);

  await assert.rejects(
    () => assertM004PublicationGate({ diagnosticsPath: fixture.diagnosticsPath, publicDir: PUBLIC_DIR, overridesDir: fixture.overridesDir }),
    /requires non-empty evidenceIds and evidence/,
  );
});

test("M004 S02 publication gate rejects duplicate public cells", async () => {
  const fixture = await createArtifactFixture();
  const override = await readJson<{ race: Race }>(fixture.overridePath);
  override.race.positions.push({ ...override.race.positions[0], id: `${override.race.positions[0].id}-duplicate-public` });
  await writeJson(fixture.overridePath, override);

  await assert.rejects(
    () => assertM004PublicationGate({ diagnosticsPath: fixture.diagnosticsPath, publicDir: PUBLIC_DIR, overridesDir: fixture.overridesDir }),
    /Duplicate public position cell/,
  );
});

test("M004 S02 publication gate rejects loader-visible records that do not match diagnostics counts", async () => {
  const fixture = await createArtifactFixture();
  const diagnostics = await readJson<BulkReviewDiagnostics>(fixture.diagnosticsPath);
  diagnostics.counts.published += 1;
  await writeJson(fixture.diagnosticsPath, diagnostics);

  await assert.rejects(
    () => assertM004PublicationGate({ diagnosticsPath: fixture.diagnosticsPath, publicDir: PUBLIC_DIR, overridesDir: fixture.overridesDir }),
    /Diagnostics published count .* does not match loader-visible public positions/,
  );
});

async function assertM004PublicationGate(options: { diagnosticsPath: string; publicDir: string; overridesDir: string }): Promise<{ diagnostics: BulkReviewDiagnostics; publicPositions: Position[] }> {
  const diagnostics = await readDiagnostics(options.diagnosticsPath);
  assertDiagnosticsShape(diagnostics, options.diagnosticsPath);

  const diagnosticsText = JSON.stringify(diagnostics);
  assert.doesNotMatch(diagnosticsText, SECRET_PATTERN, "Diagnostics must not contain secret-like tokens.");
  assert.ok(diagnostics.checkedFiles.includes(diagnostics.sourceDraftPath), `Diagnostics checkedFiles should include source draft ${diagnostics.sourceDraftPath}.`);
  assert.equal(await pathExists(diagnostics.sourceDraftPath), true, `Diagnostics source draft is stale or missing: ${diagnostics.sourceDraftPath}`);
  for (const checkedFile of diagnostics.checkedFiles) {
    if (checkedFile.startsWith("../../")) continue;
    assert.equal(await pathExists(checkedFile), true, `Diagnostics checked output path is stale or missing: ${checkedFile}`);
  }

  assert.ok(diagnostics.counts.published >= 1, "Diagnostics should report at least one published public position.");
  assert.ok(diagnostics.counts.hidden >= 1, "Diagnostics should report hidden unsafe records.");
  assert.ok(
    diagnostics.issues.some((issue) => issue.status === "hidden" && HIDDEN_UNSAFE_REASON_CODES.has(issue.reasonCode)),
    "Expected hidden duplicate/not-requested diagnostics with reason codes.",
  );
  if (diagnostics.counts.rejected > 0) {
    assert.ok(
      diagnostics.issues.some((issue) => issue.status === "rejected" && REPAIRABLE_REJECTED_REASON_CODES.has(issue.reasonCode)),
      "Rejected diagnostics, when present, should name repairable source/race mapping gaps.",
    );
  }

  const publicData = await loadPublicReferenceData(options.publicDir);
  const overridePublicCells = new Map<string, string>();
  const seenPublicCells = new Map<string, string>();
  const loaderVisiblePublicPositions: Position[] = [];

  for (const raceResult of diagnostics.races) {
    assert.equal(await pathExists(raceResult.reviewPath), true, `Review path from diagnostics is missing: ${raceResult.reviewPath}`);
    if (raceResult.overridePath) {
      const overridePath = path.join(options.overridesDir, "races", `${raceResult.raceSlug}.json`);
      const overrideExists = await pathExists(overridePath);
      assert.ok(overrideExists || raceResult.status === "prepared", `Published/failed race override path is missing: ${overridePath}`);
      if (overrideExists) {
        const override = await readJson<{ race: Partial<Race> }>(overridePath);
        for (const position of override.race.positions ?? []) {
          if (position.publicationStatus !== "public") continue;
          assert.equal(PUBLIC_STATUSES.has(position.status), true, `${position.id} has unsupported public status ${position.status}.`);
          assert.ok(position.evidenceIds.length > 0 && position.evidence.length > 0, `${position.id} requires non-empty evidenceIds and evidence.`);
          const key = cellKey(position.raceId, position.sourceId, position.entityId, position.kind);
          const previous = overridePublicCells.get(key);
          assert.ok(!previous, `Duplicate public position cell ${key} in ${previous} and ${position.id}; duplicates must be hidden, not public.`);
          overridePublicCells.set(key, position.id);
        }
      }
    }

    const loaded = await loadPublicRaceData(raceResult.raceSlug, { publicDir: options.publicDir, overridesDir: options.overridesDir });
    assert.ok(loaded, `Public loader did not load touched race ${raceResult.raceSlug}.`);
    for (const positionId of raceResult.publicPositionIds) {
      assert.ok(loaded.race.positions.some((position) => position.id === positionId), `Public loader dropped diagnostics public position ${positionId} for ${raceResult.raceSlug}.`);
    }

    for (const position of loaded.race.positions.filter((candidate) => raceResult.publicPositionIds.includes(candidate.id))) {
      assertKnownPublicPosition(position, loaded.race, publicData);
      const key = cellKey(position.raceId, position.sourceId, position.entityId, position.kind);
      const previous = seenPublicCells.get(key);
      assert.ok(!previous, `Duplicate public position cell ${key} in ${previous} and ${position.id}; duplicates must be hidden, not public.`);
      seenPublicCells.set(key, position.id);
      loaderVisiblePublicPositions.push(position);
    }
  }

  assert.equal(loaderVisiblePublicPositions.length, diagnostics.counts.published, `Diagnostics published count ${diagnostics.counts.published} does not match loader-visible public positions ${loaderVisiblePublicPositions.length}.`);
  assert.equal(loaderVisiblePublicPositions.length, diagnostics.counts.public, `Diagnostics public count ${diagnostics.counts.public} does not match loader-visible public positions ${loaderVisiblePublicPositions.length}.`);

  return { diagnostics, publicPositions: loaderVisiblePublicPositions };
}

function assertDiagnosticsShape(diagnostics: BulkReviewDiagnostics, diagnosticsPath: string): void {
  assert.equal(typeof diagnostics.ok, "boolean", `${diagnosticsPath}: diagnostics.ok must be boolean.`);
  assert.equal(typeof diagnostics.generatedAt, "string", `${diagnosticsPath}: diagnostics.generatedAt must be string.`);
  assert.ok(Array.isArray(diagnostics.checkedFiles), `${diagnosticsPath}: diagnostics.checkedFiles must be an array.`);
  assert.equal(typeof diagnostics.sourceDraftPath, "string", `${diagnosticsPath}: diagnostics.sourceDraftPath must be string.`);
  assert.equal(typeof diagnostics.diagnosticsPath, "string", `${diagnosticsPath}: diagnostics.diagnosticsPath must be string.`);
  assert.equal(diagnostics.diagnosticsPath, diagnosticsPath, `${diagnosticsPath}: diagnosticsPath should identify the file being verified.`);
  assert.equal(typeof diagnostics.counts?.published, "number", `${diagnosticsPath}: diagnostics.counts.published must be a number.`);
  assert.equal(typeof diagnostics.counts?.hidden, "number", `${diagnosticsPath}: diagnostics.counts.hidden must be a number.`);
  assert.equal(typeof diagnostics.counts?.rejected, "number", `${diagnosticsPath}: diagnostics.counts.rejected must be a number.`);
  assert.equal(typeof diagnostics.counts?.errors, "number", `${diagnosticsPath}: diagnostics.counts.errors must be a number.`);
  assert.ok(Array.isArray(diagnostics.races), `${diagnosticsPath}: diagnostics.races must be an array.`);
  assert.ok(Array.isArray(diagnostics.issues), `${diagnosticsPath}: diagnostics.issues must be an array.`);

  for (const [index, issue] of diagnostics.issues.entries()) {
    assert.match(issue.phase, /^(read|validate|prepare|review|publish|load|write)$/, `Issue ${index} has unsupported phase ${issue.phase}.`);
    assert.match(issue.status, /^(hidden|rejected|error)$/, `Issue ${index} has unsupported status ${issue.status}.`);
    assert.ok(issue.reasonCode.trim(), `Issue ${index} is missing reasonCode.`);
    assert.ok(issue.path.trim(), `Issue ${index} is missing path.`);
    assert.ok(issue.message.trim(), `Issue ${index} is missing message.`);
  }
}

function assertKnownPublicPosition(position: Position, race: Race, publicData: PublicReferenceData): void {
  assert.equal(publicData.raceIds.has(position.raceId), true, `${position.id} references unknown raceId ${position.raceId}.`);
  assert.equal(publicData.sourceIds.has(position.sourceId), true, `${position.id} references unknown sourceId ${position.sourceId}.`);
  assert.equal(publicData.entityIds.has(position.entityId), true, `${position.id} references unknown entityId ${position.entityId}.`);
  assert.equal(position.raceId, race.id, `${position.id} raceId must match loaded race ${race.id}.`);
  assert.equal(race.sourceIds.includes(position.sourceId), true, `${position.id} sourceId ${position.sourceId} is not mapped to race ${race.id}.`);
  assert.equal(race.entityIds.includes(position.entityId), true, `${position.id} entityId ${position.entityId} is not mapped to race ${race.id}.`);
  assert.equal(PUBLIC_STATUSES.has(position.status), true, `${position.id} has unsupported public status ${position.status}.`);
  assert.equal(position.publicationStatus, "public", `${position.id} must have publicationStatus public.`);
  assert.ok(position.evidenceIds.length > 0 && position.evidence.length > 0, `${position.id} requires non-empty evidenceIds and evidence.`);
  for (const evidenceId of position.evidenceIds) {
    assert.ok(position.evidence.some((evidence) => evidence.id === evidenceId), `${position.id} evidenceIds references missing evidence ${evidenceId}.`);
  }
  for (const evidence of position.evidence) {
    assert.equal(publicData.sourceIds.has(evidence.sourceId), true, `${position.id} evidence ${evidence.id} references unknown sourceId ${evidence.sourceId}.`);
    if (evidence.entityId) assert.equal(publicData.entityIds.has(evidence.entityId), true, `${position.id} evidence ${evidence.id} references unknown entityId ${evidence.entityId}.`);
    if (evidence.raceId) assert.equal(publicData.raceIds.has(evidence.raceId), true, `${position.id} evidence ${evidence.id} references unknown raceId ${evidence.raceId}.`);
    assert.ok(evidence.quote.trim(), `${position.id} evidence ${evidence.id} requires quote provenance.`);
    assert.ok(evidence.url.trim(), `${position.id} evidence ${evidence.id} requires url provenance.`);
    assert.ok(evidence.artifactId?.trim(), `${position.id} evidence ${evidence.id} requires artifactId provenance.`);
    assert.ok(evidence.chunkId?.trim(), `${position.id} evidence ${evidence.id} requires chunkId provenance.`);
  }
}

async function readDiagnostics(diagnosticsPath: string): Promise<BulkReviewDiagnostics> {
  try {
    return await readJson<BulkReviewDiagnostics>(diagnosticsPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") throw new Error(`Missing diagnostics at ${diagnosticsPath}. Run pnpm review:bulk -- --draft data/extracted/drafts/m004-s02-agent-bulk.json --validation data/extracted/validation/m004-s02-agent-bulk.json --diagnostics ${diagnosticsPath} --publish before closeout.`);
    throw error;
  }
}

async function loadPublicReferenceData(publicDir: string): Promise<PublicReferenceData> {
  const sources = await readJson<{ sources: Array<{ id: string }> }>(path.join(publicDir, "sources.json"));
  const entities = await readJson<{ entities: Array<{ id: string }> }>(path.join(publicDir, "entities.json"));
  const racesDir = path.join(publicDir, "races");
  const raceFiles = (await fs.readdir(racesDir)).filter((file) => file.endsWith(".json"));
  const raceIds = new Set<string>();
  for (const file of raceFiles) {
    const raceFile = await readJson<{ race: Race }>(path.join(racesDir, file));
    raceIds.add(raceFile.race.id);
  }
  return { sourceIds: new Set(sources.sources.map((source) => source.id)), entityIds: new Set(entities.entities.map((entity) => entity.id)), raceIds };
}

async function createArtifactFixture(): Promise<{ root: string; overridesDir: string; diagnosticsPath: string; overridePath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "votes-m004-closeout-"));
  const overridesDir = path.join(root, "manual", "overrides");
  const diagnosticsPath = path.join(root, "data", "reviewed", "m004-s02-bulk-latest.json");
  const overridePath = path.join(overridesDir, "races", "state-assembly-district-17.json");
  await fs.mkdir(path.dirname(diagnosticsPath), { recursive: true });
  await fs.mkdir(path.dirname(overridePath), { recursive: true });
  await fs.copyFile(DIAGNOSTICS_PATH, diagnosticsPath);
  const diagnostics = await readJson<BulkReviewDiagnostics>(diagnosticsPath);
  for (const raceResult of diagnostics.races) {
    const sourceOverridePath = path.join("manual", "overrides", "races", `${raceResult.raceSlug}.json`);
    if (await pathExists(sourceOverridePath)) {
      const targetOverridePath = path.join(overridesDir, "races", `${raceResult.raceSlug}.json`);
      await fs.mkdir(path.dirname(targetOverridePath), { recursive: true });
      await fs.copyFile(sourceOverridePath, targetOverridePath);
    }
  }
  diagnostics.diagnosticsPath = diagnosticsPath;
  diagnostics.checkedFiles = diagnostics.checkedFiles.map((checkedFile) => (checkedFile === DIAGNOSTICS_PATH ? diagnosticsPath : checkedFile));
  await writeJson(diagnosticsPath, diagnostics);
  return { root, overridesDir, diagnosticsPath, overridePath };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function cellKey(raceId: string, sourceId: string, entityId: string, kind: string): string {
  return `${raceId}\u0000${sourceId}\u0000${entityId}\u0000${kind}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

interface PublicReferenceData {
  sourceIds: Set<string>;
  entityIds: Set<string>;
  raceIds: Set<string>;
}

interface BulkReviewDiagnostics {
  ok: boolean;
  generatedAt: string;
  checkedFiles: string[];
  sourceDraftPath: string;
  diagnosticsPath: string;
  counts: {
    positions: number;
    races: number;
    published: number;
    public: number;
    hidden: number;
    rejected: number;
    errors: number;
    issues: number;
  };
  races: Array<{
    raceSlug: string;
    raceId: string;
    reviewPath: string;
    overridePath?: string;
    status: "prepared" | "published" | "failed";
    counts: {
      positions: number;
      public: number;
      hidden: number;
      rejected: number;
      issues: number;
      errors: number;
    };
    publicPositionIds: string[];
    issueCodes: string[];
  }>;
  issues: Array<{
    phase: string;
    status: string;
    reasonCode: string;
    path: string;
    message: string;
    raceId?: string;
    raceSlug?: string;
    sourceId?: string;
    entityId?: string;
    artifactId?: string;
    chunkId?: string;
    positionId?: string;
    evidenceId?: string;
  }>;
}
