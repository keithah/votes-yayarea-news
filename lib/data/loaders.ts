import { promises as fs } from "node:fs";
import path from "node:path";
import type { Entity, PublicDataRepository, Race, ReviewStatus, Source, Summary, Theme, Position } from "./types";
import { validatePublicData, type ValidationIssue } from "./validate";

export type DataLoadPhase = "canonical" | "override" | "merged" | "public-filter";

export interface LoaderOptions {
  publicDir?: string;
  overridesDir?: string;
}

export interface LoadedRaceData {
  race: Race;
  checkedFiles: string[];
}

export interface LoadedPublicRaceContext {
  race: Race;
  sources: Source[];
  entities: Entity[];
  checkedFiles: string[];
}

export class DataLoadError extends Error {
  readonly phase: DataLoadPhase;
  readonly slug?: string;
  readonly sourcePath?: string;
  readonly issues: ValidationIssue[];

  constructor(message: string, options: { phase: DataLoadPhase; slug?: string; sourcePath?: string; issues?: ValidationIssue[] }) {
    super(message);
    this.name = "DataLoadError";
    this.phase = options.phase;
    this.slug = options.slug;
    this.sourcePath = options.sourcePath;
    this.issues = options.issues ?? [];
  }
}

const DEFAULT_PUBLIC_DIR = path.join(process.cwd(), "data", "public");
const DEFAULT_OVERRIDES_DIR = path.join(process.cwd(), "manual", "overrides");
const PUBLIC_REVIEW_STATUSES = new Set<ReviewStatus>(["verified", "published"]);

export async function listRaceSlugs(options: LoaderOptions = {}): Promise<string[]> {
  const { repository } = await loadCanonicalRepository(options);
  return repository.races.map((race) => race.slug).sort();
}

export async function loadRaceData(slug: string, options: LoaderOptions = {}): Promise<LoadedRaceData | null> {
  const canonical = await loadCanonicalRepository(options);
  const canonicalRace = canonical.repository.races.find((race) => race.slug === slug);
  if (!canonicalRace) return null;

  const overridePath = path.join(resolveOverridesDir(options), "races", `${slug}.json`);
  const overrideRace = await readOptionalRaceOverride(overridePath, slug);
  const mergedRace = overrideRace ? mergeRace(canonicalRace, overrideRace, slug, relativePath(overridePath)) : clone(canonicalRace);
  const mergedRepository = replaceRace(canonical.repository, mergedRace);
  assertValidRepository(mergedRepository, [...canonical.checkedFiles, ...(overrideRace ? [relativePath(overridePath)] : [])], "merged", slug, overrideRace ? relativePath(overridePath) : undefined);

  return {
    race: mergedRace,
    checkedFiles: [...canonical.checkedFiles, ...(overrideRace ? [relativePath(overridePath)] : [])],
  };
}

export async function loadPublicRaceData(slug: string, options: LoaderOptions = {}): Promise<LoadedRaceData | null> {
  const loaded = await loadRaceData(slug, options);
  if (!loaded) return null;
  if (!isPublicRecord(loaded.race)) return null;

  const filteredRace = filterPublicRace(loaded.race);
  const canonical = await loadCanonicalRepository(options);
  const publicRepository = replaceRace(canonical.repository, filteredRace);
  assertValidRepository(publicRepository, loaded.checkedFiles, "public-filter", slug);

  return {
    race: filteredRace,
    checkedFiles: loaded.checkedFiles,
  };
}

export async function loadPublicRaceContext(slug: string, options: LoaderOptions = {}): Promise<LoadedPublicRaceContext | null> {
  const loaded = await loadPublicRaceData(slug, options);
  if (!loaded) return null;

  const canonical = await loadCanonicalRepository(options);
  const sourceIds = collectReferencedSourceIds(loaded.race);
  const entityIds = collectReferencedEntityIds(loaded.race);

  return {
    race: loaded.race,
    sources: canonical.repository.sources.filter((source) => sourceIds.has(source.id)),
    entities: canonical.repository.entities.filter((entity) => entityIds.has(entity.id)),
    checkedFiles: loaded.checkedFiles,
  };
}

export function mergeRace(canonicalRace: Race, overrideRace: Partial<Race>, slug = canonicalRace.slug, sourcePath = "manual override"): Race {
  assertNoDuplicateIds(overrideRace.positions, `${sourcePath}.race.positions`, slug);
  assertNoDuplicateIds(overrideRace.themes, `${sourcePath}.race.themes`, slug);
  overrideRace.positions?.forEach((position, index) => assertNoDuplicateIds(position.evidence, `${sourcePath}.race.positions[${index}].evidence`, slug));
  return mergeValue(canonicalRace, overrideRace) as Race;
}

function filterPublicRace(race: Race): Race {
  const positions = race.positions.filter(isPublicRecord).map((position) => ({ ...position, evidence: position.evidence.slice() }));
  const publicEvidenceIds = new Set(positions.flatMap((position) => position.evidence.map((evidence) => evidence.id)));
  const themes = filterPublicThemes(race.themes, publicEvidenceIds);
  const summary = filterPublicSummary(race.summary, publicEvidenceIds);

  return {
    ...race,
    positions,
    ...(themes.length > 0 ? { themes } : { themes: undefined }),
    ...(summary ? { summary } : { summary: undefined }),
  };
}

function filterPublicThemes(themes: Theme[] | undefined, publicEvidenceIds: Set<string>): Theme[] {
  return (themes ?? [])
    .map((theme) => ({ ...theme, evidenceIds: uniquePublicEvidenceIds(theme.evidenceIds, publicEvidenceIds) }))
    .filter((theme) => theme.evidenceIds.length > 0);
}

function filterPublicSummary(summary: Summary | undefined, publicEvidenceIds: Set<string>): Summary | undefined {
  if (!summary || !isPublicRecord(summary)) return undefined;
  const evidenceIds = uniquePublicEvidenceIds(summary.evidenceIds, publicEvidenceIds);
  return evidenceIds.length > 0 ? { ...summary, evidenceIds } : undefined;
}

function uniquePublicEvidenceIds(evidenceIds: string[], publicEvidenceIds: Set<string>): string[] {
  return [...new Set(evidenceIds.filter((evidenceId) => publicEvidenceIds.has(evidenceId)))];
}

function isPublicRecord(record: { status: ReviewStatus; publicationStatus?: string }): boolean {
  return PUBLIC_REVIEW_STATUSES.has(record.status) && record.publicationStatus === "public";
}

function collectReferencedSourceIds(race: Race): Set<string> {
  return new Set([
    ...race.sourceIds,
    ...race.positions.map((position) => position.sourceId),
    ...race.positions.flatMap((position) => position.evidence.map((evidence) => evidence.sourceId)),
  ]);
}

function collectReferencedEntityIds(race: Race): Set<string> {
  return new Set([
    ...race.entityIds,
    ...race.positions.map((position) => position.entityId),
    ...race.positions.flatMap((position) => position.evidence.map((evidence) => evidence.entityId).filter(isString)),
  ]);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

async function loadCanonicalRepository(options: LoaderOptions): Promise<{ repository: PublicDataRepository; checkedFiles: string[] }> {
  const publicDir = resolvePublicDir(options);
  const checkedFiles: string[] = [];
  const repository: PublicDataRepository = {
    sources: await readTopLevelArray(path.join(publicDir, "sources.json"), "sources", checkedFiles),
    entities: await readTopLevelArray(path.join(publicDir, "entities.json"), "entities", checkedFiles),
    collections: await readTopLevelArray(path.join(publicDir, "collections.json"), "collections", checkedFiles),
    races: await readRaces(path.join(publicDir, "races"), checkedFiles),
  };
  assertValidRepository(repository, checkedFiles, "canonical");
  return { repository, checkedFiles };
}

async function readTopLevelArray<T>(filePath: string, key: string, checkedFiles: string[]): Promise<T[]> {
  const json = await readJson(filePath, checkedFiles, "canonical");
  if (!isRecord(json) || !Array.isArray(json[key])) {
    throw new DataLoadError(`Invalid canonical data shape at ${relativePath(filePath)}: expected top-level '${key}' array`, {
      phase: "canonical",
      sourcePath: relativePath(filePath),
      issues: [{ path: relativePath(filePath), code: "invalid_shape", message: `Expected top-level '${key}' array` }],
    });
  }
  return json[key] as T[];
}

async function readRaces(racesDir: string, checkedFiles: string[]): Promise<Race[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(racesDir);
  } catch (error) {
    throw new DataLoadError(`Unable to read canonical races directory ${relativePath(racesDir)}: ${formatError(error)}`, {
      phase: "canonical",
      sourcePath: relativePath(racesDir),
    });
  }

  const races: Race[] = [];
  for (const entry of entries.filter((file) => file.endsWith(".json")).sort()) {
    const filePath = path.join(racesDir, entry);
    const json = await readJson(filePath, checkedFiles, "canonical");
    if (!isRecord(json) || !isRecord(json.race)) {
      throw new DataLoadError(`Invalid canonical race shape at ${relativePath(filePath)}: expected top-level 'race' object`, {
        phase: "canonical",
        sourcePath: relativePath(filePath),
        issues: [{ path: relativePath(filePath), code: "invalid_shape", message: "Expected top-level 'race' object" }],
      });
    }
    races.push(json.race as unknown as Race);
  }
  return races;
}

async function readOptionalRaceOverride(filePath: string, slug: string): Promise<Partial<Race> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw new DataLoadError(`Unable to read override for race '${slug}' at ${relativePath(filePath)}: ${formatError(error)}`, {
      phase: "override",
      slug,
      sourcePath: relativePath(filePath),
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new DataLoadError(`Malformed override JSON for race '${slug}' at ${relativePath(filePath)}: ${formatError(error)}`, {
      phase: "override",
      slug,
      sourcePath: relativePath(filePath),
      issues: [{ path: relativePath(filePath), code: "malformed_json", message: formatError(error) }],
    });
  }

  if (!isRecord(json) || !isRecord(json.race)) {
    throw new DataLoadError(`Invalid override shape for race '${slug}' at ${relativePath(filePath)}: expected top-level 'race' object`, {
      phase: "override",
      slug,
      sourcePath: relativePath(filePath),
      issues: [{ path: relativePath(filePath), code: "invalid_shape", message: "Expected top-level 'race' object" }],
    });
  }
  return json.race as Partial<Race>;
}

async function readJson(filePath: string, checkedFiles: string[], phase: DataLoadPhase): Promise<unknown> {
  checkedFiles.push(relativePath(filePath));
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new DataLoadError(`Unable to load ${phase} JSON at ${relativePath(filePath)}: ${formatError(error)}`, {
      phase,
      sourcePath: relativePath(filePath),
      issues: [{ path: relativePath(filePath), code: isSyntaxError(error) ? "malformed_json" : "read_error", message: formatError(error) }],
    });
  }
}

function assertValidRepository(repository: PublicDataRepository, checkedFiles: string[], phase: DataLoadPhase, slug?: string, sourcePath?: string): void {
  const result = validatePublicData(repository, checkedFiles);
  if (result.ok) return;
  const context = slug ? ` for race '${slug}'` : "";
  const first = result.issues[0];
  throw new DataLoadError(`Data validation failed during ${phase}${context}: ${first.path} [${first.code}] ${first.message}`, {
    phase,
    slug,
    sourcePath,
    issues: result.issues,
  });
}

function replaceRace(repository: PublicDataRepository, race: Race): PublicDataRepository {
  return {
    ...repository,
    races: repository.races.map((candidate) => (candidate.slug === race.slug || candidate.id === race.id ? race : candidate)),
  };
}

function mergeValue(canonical: unknown, override: unknown): unknown {
  if (Array.isArray(canonical) && Array.isArray(override)) return mergeArrayById(canonical, override);
  if (isRecord(canonical) && isRecord(override)) {
    const merged: Record<string, unknown> = { ...canonical };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = key in merged ? mergeValue(merged[key], value) : clone(value);
    }
    return merged;
  }
  return clone(override);
}

function mergeArrayById(canonical: unknown[], override: unknown[]): unknown[] {
  const merged = canonical.map((item) => clone(item));
  const indexes = new Map<string, number>();
  merged.forEach((item, index) => {
    if (isRecord(item) && typeof item.id === "string") indexes.set(item.id, index);
  });

  for (const overrideItem of override) {
    if (isRecord(overrideItem) && typeof overrideItem.id === "string") {
      const existingIndex = indexes.get(overrideItem.id);
      if (existingIndex !== undefined) {
        merged[existingIndex] = mergeValue(merged[existingIndex], overrideItem);
        continue;
      }
      indexes.set(overrideItem.id, merged.length);
    }
    merged.push(clone(overrideItem));
  }
  return merged;
}

function assertNoDuplicateIds(items: unknown[] | undefined, issuePath: string, slug: string): void {
  if (!items) return;
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    if (seen.has(item.id)) {
      throw new DataLoadError(`Duplicate override record '${item.id}' for race '${slug}' at ${issuePath}`, {
        phase: "override",
        slug,
        sourcePath: issuePath,
        issues: [{ path: issuePath, code: "duplicate_id", message: `Duplicate override record '${item.id}'` }],
      });
    }
    seen.add(item.id);
  }
}

function resolvePublicDir(options: LoaderOptions): string {
  return options.publicDir ?? DEFAULT_PUBLIC_DIR;
}

function resolveOverridesDir(options: LoaderOptions): string {
  return options.overridesDir ?? DEFAULT_OVERRIDES_DIR;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}
