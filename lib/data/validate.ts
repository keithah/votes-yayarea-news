import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  Collection,
  Entity,
  Evidence,
  Position,
  PublicDataRepository,
  Race,
  Source,
} from "./types";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationCounts {
  sources: number;
  entities: number;
  collections: number;
  races: number;
  positions: number;
  evidence: number;
}

export interface ValidationResult {
  ok: boolean;
  checkedFiles: string[];
  counts: ValidationCounts;
  issues: ValidationIssue[];
}

export interface LoadedPublicData {
  repository: PublicDataRepository;
  checkedFiles: string[];
  issues: ValidationIssue[];
}

const ID_OR_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVIEW_STATUSES = new Set(["draft", "reviewed", "verified", "published", "rejected"]);
const PUBLICATION_STATUSES = new Set(["hidden", "public", "archived"]);
const SOURCE_STATUSES = new Set(["pending", "active", "excluded", "archived"]);
const ENTITY_KINDS = new Set(["candidate", "measure", "office", "organization", "person", "other"]);
const COLLECTION_KINDS = new Set(["race", "ballot-measure-collection", "office-group", "topic"]);
const RACE_KINDS = new Set(["local-executive", "local-legislative", "statewide-executive", "federal-legislative", "ballot-measure", "collection", "other"]);
const POSITION_KINDS = new Set(["endorse", "oppose", "rank", "no-position", "informational"]);
const EVIDENCE_KINDS = new Set(["quote", "snippet", "summary", "link"]);
const THEME_SENTIMENTS = new Set(["support", "concern", "neutral"]);

export function validatePublicData(repository: PublicDataRepository, checkedFiles: string[] = []): ValidationResult {
  const issues: ValidationIssue[] = [];
  const sources = Array.isArray(repository.sources) ? repository.sources : [];
  const entities = Array.isArray(repository.entities) ? repository.entities : [];
  const collections = Array.isArray(repository.collections) ? repository.collections : [];
  const races = Array.isArray(repository.races) ? repository.races : [];

  if (!Array.isArray(repository.sources)) addIssue(issues, "sources", "invalid_shape", "sources must be an array");
  if (!Array.isArray(repository.entities)) addIssue(issues, "entities", "invalid_shape", "entities must be an array");
  if (!Array.isArray(repository.collections)) addIssue(issues, "collections", "invalid_shape", "collections must be an array");
  if (!Array.isArray(repository.races)) addIssue(issues, "races", "invalid_shape", "races must be an array");

  validateDuplicates(sources, "sources", "id", issues);
  validateDuplicates(sources, "sources", "slug", issues);
  validateDuplicates(entities, "entities", "id", issues);
  validateDuplicates(entities, "entities", "slug", issues);
  validateDuplicates(collections, "collections", "id", issues);
  validateDuplicates(collections, "collections", "slug", issues);
  validateDuplicates(races, "races", "id", issues);
  validateDuplicates(races, "races", "slug", issues);

  const sourceIds = new Set(sources.map((source) => source.id));
  const entityIds = new Set(entities.map((entity) => entity.id));
  const raceIds = new Set(races.map((race) => race.id));

  sources.forEach((source, index) => validateSource(source, `sources[${index}]`, issues));
  entities.forEach((entity, index) => validateEntity(entity, `entities[${index}]`, issues));
  collections.forEach((collection, index) => validateCollection(collection, `collections[${index}]`, raceIds, issues));

  const allEvidenceIds = new Set<string>();
  races.forEach((race, raceIndex) => {
    validateRace(race, `races[${raceIndex}]`, sourceIds, entityIds, issues);
    race.positions?.forEach((position, positionIndex) => {
      const positionPath = `races[${raceIndex}].positions[${positionIndex}]`;
      validatePosition(position, positionPath, race, sourceIds, entityIds, issues);
      position.evidence?.forEach((evidence, evidenceIndex) => {
        const evidencePath = `${positionPath}.evidence[${evidenceIndex}]`;
        validateEvidence(evidence, evidencePath, raceIds, sourceIds, entityIds, issues);
        if (allEvidenceIds.has(evidence.id)) {
          addIssue(issues, `${evidencePath}.id`, "duplicate_id", `Duplicate evidence id '${evidence.id}'`);
        }
        allEvidenceIds.add(evidence.id);
      });
    });
  });

  races.forEach((race, raceIndex) => {
    const raceEvidenceIds = new Set((race.positions ?? []).flatMap((position) => position.evidence?.map((evidence) => evidence.id) ?? []));
    race.positions?.forEach((position, positionIndex) => {
      position.evidenceIds?.forEach((evidenceId, evidenceIdIndex) => {
        if (!raceEvidenceIds.has(evidenceId)) {
          addIssue(issues, `races[${raceIndex}].positions[${positionIndex}].evidenceIds[${evidenceIdIndex}]`, "missing_reference", `Evidence '${evidenceId}' does not exist in race '${race.id}'`);
        }
      });
    });
    race.themes?.forEach((theme, themeIndex) => {
      requireString(theme.id, `races[${raceIndex}].themes[${themeIndex}].id`, issues);
      requireString(theme.label, `races[${raceIndex}].themes[${themeIndex}].label`, issues);
      requireEnum(theme.sentiment, THEME_SENTIMENTS, `races[${raceIndex}].themes[${themeIndex}].sentiment`, issues);
      validateReferenceArray(theme.evidenceIds, `races[${raceIndex}].themes[${themeIndex}].evidenceIds`, raceEvidenceIds, "Evidence", issues);
    });
    if (race.summary) {
      requireString(race.summary.id, `races[${raceIndex}].summary.id`, issues);
      requireString(race.summary.text, `races[${raceIndex}].summary.text`, issues);
      requireEnum(race.summary.status, REVIEW_STATUSES, `races[${raceIndex}].summary.status`, issues);
      requireEnum(race.summary.publicationStatus, PUBLICATION_STATUSES, `races[${raceIndex}].summary.publicationStatus`, issues);
      validateReferenceArray(race.summary.evidenceIds, `races[${raceIndex}].summary.evidenceIds`, raceEvidenceIds, "Evidence", issues);
    }
  });

  return {
    ok: issues.length === 0,
    checkedFiles,
    counts: {
      sources: sources.length,
      entities: entities.length,
      collections: collections.length,
      races: races.length,
      positions: races.reduce((count, race) => count + (race.positions?.length ?? 0), 0),
      evidence: races.reduce((count, race) => count + (race.positions?.reduce((inner, position) => inner + (position.evidence?.length ?? 0), 0) ?? 0), 0),
    },
    issues,
  };
}

export async function loadPublicData(rootDir = path.join(process.cwd(), "data", "public")): Promise<LoadedPublicData> {
  const checkedFiles: string[] = [];
  const issues: ValidationIssue[] = [];

  const sources = await readJsonArray<Source>(path.join(rootDir, "sources.json"), "sources", checkedFiles, issues);
  const entities = await readJsonArray<Entity>(path.join(rootDir, "entities.json"), "entities", checkedFiles, issues);
  const collections = await readJsonArray<Collection>(path.join(rootDir, "collections.json"), "collections", checkedFiles, issues);
  const races = await readRaceFiles(path.join(rootDir, "races"), checkedFiles, issues);

  return {
    repository: { sources, entities, collections, races },
    checkedFiles,
    issues,
  };
}

export async function validatePublicDataFiles(rootDir = path.join(process.cwd(), "data", "public")): Promise<ValidationResult> {
  const loaded = await loadPublicData(rootDir);
  const result = validatePublicData(loaded.repository, loaded.checkedFiles);
  result.issues.unshift(...loaded.issues);
  return { ...result, ok: result.issues.length === 0 };
}

function validateSource(source: Source, basePath: string, issues: ValidationIssue[]): void {
  requireKebab(source.id, `${basePath}.id`, issues);
  requireKebab(source.slug, `${basePath}.slug`, issues);
  requireString(source.name, `${basePath}.name`, issues);
  requireString(source.category, `${basePath}.category`, issues);
  requireString(source.sourceType, `${basePath}.sourceType`, issues);
  requireEnum(source.status, SOURCE_STATUSES, `${basePath}.status`, issues);
  validateOptionalUrl(source.homepageUrl, `${basePath}.homepageUrl`, issues);
  validateOptionalUrl(source.guideUrl, `${basePath}.guideUrl`, issues);
}

function validateEntity(entity: Entity, basePath: string, issues: ValidationIssue[]): void {
  requireKebab(entity.id, `${basePath}.id`, issues);
  requireKebab(entity.slug, `${basePath}.slug`, issues);
  requireString(entity.name, `${basePath}.name`, issues);
  requireEnum(entity.kind, ENTITY_KINDS, `${basePath}.kind`, issues);
  requireEnum(entity.status, REVIEW_STATUSES, `${basePath}.status`, issues);
  validateOptionalUrl(entity.officialUrl, `${basePath}.officialUrl`, issues);
}

function validateCollection(collection: Collection, basePath: string, raceIds: Set<string>, issues: ValidationIssue[]): void {
  requireKebab(collection.id, `${basePath}.id`, issues);
  requireKebab(collection.slug, `${basePath}.slug`, issues);
  requireString(collection.title, `${basePath}.title`, issues);
  requireEnum(collection.kind, COLLECTION_KINDS, `${basePath}.kind`, issues);
  requireEnum(collection.status, REVIEW_STATUSES, `${basePath}.status`, issues);
  validateReferenceArray(collection.raceIds, `${basePath}.raceIds`, raceIds, "Race", issues);
}

function validateRace(race: Race, basePath: string, sourceIds: Set<string>, entityIds: Set<string>, issues: ValidationIssue[]): void {
  requireKebab(race.id, `${basePath}.id`, issues);
  requireKebab(race.slug, `${basePath}.slug`, issues);
  requireString(race.title, `${basePath}.title`, issues);
  requireEnum(race.kind, RACE_KINDS, `${basePath}.kind`, issues);
  requireEnum(race.status, REVIEW_STATUSES, `${basePath}.status`, issues);
  requireEnum(race.publicationStatus, PUBLICATION_STATUSES, `${basePath}.publicationStatus`, issues);
  requireString(race.electionDate, `${basePath}.electionDate`, issues);
  requireString(race.jurisdiction, `${basePath}.jurisdiction`, issues);
  validateReferenceArray(race.entityIds, `${basePath}.entityIds`, entityIds, "Entity", issues);
  validateReferenceArray(race.sourceIds, `${basePath}.sourceIds`, sourceIds, "Source", issues);
  if (!Array.isArray(race.positions)) addIssue(issues, `${basePath}.positions`, "invalid_shape", "positions must be an array");
}

function validatePosition(position: Position, basePath: string, race: Race, sourceIds: Set<string>, entityIds: Set<string>, issues: ValidationIssue[]): void {
  requireKebab(position.id, `${basePath}.id`, issues);
  requireEnum(position.kind, POSITION_KINDS, `${basePath}.kind`, issues);
  requireEnum(position.status, REVIEW_STATUSES, `${basePath}.status`, issues);
  requireEnum(position.publicationStatus, PUBLICATION_STATUSES, `${basePath}.publicationStatus`, issues);
  requireString(position.label, `${basePath}.label`, issues);
  requireReference(position.raceId, `${basePath}.raceId`, new Set([race.id]), "Race", issues);
  requireReference(position.sourceId, `${basePath}.sourceId`, sourceIds, "Source", issues);
  requireReference(position.entityId, `${basePath}.entityId`, entityIds, "Entity", issues);
  validateReferenceArray(position.evidenceIds, `${basePath}.evidenceIds`, new Set((position.evidence ?? []).map((evidence) => evidence.id)), "Evidence", issues);
  if (!Array.isArray(position.evidence)) addIssue(issues, `${basePath}.evidence`, "invalid_shape", "evidence must be an array");
  if (isPubliclyVisible(position) && (position.evidence?.length ?? 0) === 0) {
    addIssue(issues, `${basePath}.evidence`, "missing_evidence", "Visible positions must include at least one evidence record");
  }
  if (isPubliclyVisible(position)) {
    position.evidence?.forEach((evidence, evidenceIndex) => validatePublicEvidenceProvenance(evidence, `${basePath}.evidence[${evidenceIndex}]`, issues));
  }
}

function validateEvidence(evidence: Evidence, basePath: string, raceIds: Set<string>, sourceIds: Set<string>, entityIds: Set<string>, issues: ValidationIssue[]): void {
  requireKebab(evidence.id, `${basePath}.id`, issues);
  requireReference(evidence.sourceId, `${basePath}.sourceId`, sourceIds, "Source", issues);
  if (evidence.entityId !== undefined) requireReference(evidence.entityId, `${basePath}.entityId`, entityIds, "Entity", issues);
  if (evidence.raceId !== undefined) requireReference(evidence.raceId, `${basePath}.raceId`, raceIds, "Race", issues);
  if (evidence.artifactId !== undefined) requireKebab(evidence.artifactId, `${basePath}.artifactId`, issues);
  if (evidence.chunkId !== undefined) requireKebab(evidence.chunkId, `${basePath}.chunkId`, issues);
  requireString(evidence.quote, `${basePath}.quote`, issues);
  requireEnum(evidence.kind, EVIDENCE_KINDS, `${basePath}.kind`, issues);
  validateUrl(evidence.url, `${basePath}.url`, issues);
}

function validatePublicEvidenceProvenance(evidence: Evidence, basePath: string, issues: ValidationIssue[]): void {
  if (evidence.artifactId === undefined && evidence.chunkId === undefined) return;
  if (evidence.artifactId === undefined) {
    addIssue(issues, `${basePath}.artifactId`, "missing_provenance", "Public extraction evidence with chunk provenance must include artifactId");
  }
  if (evidence.chunkId === undefined) {
    addIssue(issues, `${basePath}.chunkId`, "missing_provenance", "Public extraction evidence with artifact provenance must include chunkId");
  }
}

function validateDuplicates<T extends object>(items: T[], basePath: string, key: string, issues: ValidationIssue[]): void {
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    const value = (item as Record<string, unknown>)[key];
    if (typeof value !== "string") return;
    const firstIndex = seen.get(value);
    if (firstIndex !== undefined) {
      addIssue(issues, `${basePath}[${index}].${key}`, "duplicate_id", `Duplicate ${key} '${value}' first seen at ${basePath}[${firstIndex}].${key}`);
    } else {
      seen.set(value, index);
    }
  });
}

function validateReferenceArray(value: unknown, basePath: string, allowed: Set<string>, label: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value)) {
    addIssue(issues, basePath, "invalid_shape", `${basePath} must be an array`);
    return;
  }
  value.forEach((entry, index) => requireReference(entry, `${basePath}[${index}]`, allowed, label, issues));
}

function requireReference(value: unknown, issuePath: string, allowed: Set<string>, label: string, issues: ValidationIssue[]): void {
  if (!requireString(value, issuePath, issues)) return;
  if (!allowed.has(value)) addIssue(issues, issuePath, "missing_reference", `${label} '${value}' does not exist`);
}

function requireKebab(value: unknown, issuePath: string, issues: ValidationIssue[]): boolean {
  if (!requireString(value, issuePath, issues)) return false;
  if (!ID_OR_SLUG_PATTERN.test(value)) {
    addIssue(issues, issuePath, "invalid_format", "Must be lowercase kebab-case");
    return false;
  }
  return true;
}

function requireString(value: unknown, issuePath: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    addIssue(issues, issuePath, "required_string", "Must be a non-empty string");
    return false;
  }
  return true;
}

function requireEnum(value: unknown, allowed: Set<string>, issuePath: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !allowed.has(value)) {
    addIssue(issues, issuePath, "unsupported_status", `Unsupported value '${String(value)}'`);
  }
}

function validateOptionalUrl(value: unknown, issuePath: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  validateUrl(value, issuePath, issues);
}

function validateUrl(value: unknown, issuePath: string, issues: ValidationIssue[]): void {
  if (!requireString(value, issuePath, issues)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http or https");
  } catch {
    addIssue(issues, issuePath, "invalid_url", "Must be a parseable http(s) URL");
  }
}

function isPubliclyVisible(position: Position): boolean {
  return position.publicationStatus === "public" || position.status === "reviewed" || position.status === "verified" || position.status === "published";
}

function addIssue(issues: ValidationIssue[], issuePath: string, code: string, message: string): void {
  issues.push({ path: issuePath, code, message });
}

async function readJsonArray<T>(filePath: string, key: string, checkedFiles: string[], issues: ValidationIssue[]): Promise<T[]> {
  const json = await readJson(filePath, checkedFiles, issues);
  if (json === undefined) return [];
  if (!isRecord(json) || !Array.isArray(json[key])) {
    addIssue(issues, relativePath(filePath), "invalid_shape", `Expected top-level '${key}' array`);
    return [];
  }
  return json[key] as T[];
}

async function readRaceFiles(racesDir: string, checkedFiles: string[], issues: ValidationIssue[]): Promise<Race[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(racesDir);
  } catch (error) {
    addIssue(issues, relativePath(racesDir), "missing_file", `Unable to read races directory: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }

  const raceFiles = entries.filter((entry) => entry.endsWith(".json")).sort();
  const races: Race[] = [];
  for (const file of raceFiles) {
    const filePath = path.join(racesDir, file);
    const json = await readJson(filePath, checkedFiles, issues);
    if (json === undefined) continue;
    if (!isRecord(json) || !isRecord(json.race)) {
      addIssue(issues, relativePath(filePath), "invalid_shape", "Expected top-level 'race' object");
      continue;
    }
    races.push(json.race as unknown as Race);
  }
  if (raceFiles.length === 0) addIssue(issues, relativePath(racesDir), "missing_file", "No race JSON files found");
  return races;
}

async function readJson(filePath: string, checkedFiles: string[], issues: ValidationIssue[]): Promise<unknown | undefined> {
  checkedFiles.push(relativePath(filePath));
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    addIssue(issues, relativePath(filePath), "missing_file", `Unable to read file: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    addIssue(issues, relativePath(filePath), "malformed_json", `Malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}
