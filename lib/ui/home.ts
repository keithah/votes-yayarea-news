import { promises as fs } from "node:fs";
import path from "node:path";
import { listRaceSlugs, loadPublicRaceContext, type LoaderOptions } from "../data/loaders";
import { emptySourceRaceCoverageStatusCounts, type SourceRaceCoverageStatus } from "../data/sourceRaceCoverage";
import type { RaceKind } from "../data/types";
import { buildRaceUiModel, type PlaceholderReadiness, type RaceUiModel, type SourceTypeBreakdown } from "./race";

export type HomeRaceSectionId = "statewide-broader" | "local";

export interface HomePageModel {
  races: HomeRaceModel[];
  sections: HomeRaceSection[];
  totals: HomeRaceTotals;
  diagnostics: HomePageDiagnostics;
}

export interface HomeRaceSection {
  id: HomeRaceSectionId;
  title: string;
  deck: string;
  races: HomeRaceModel[];
  diagnostics: HomeRaceSectionDiagnostics;
}

export interface HomeRaceModel {
  race: RaceUiModel["race"];
  consensus: RaceUiModel["consensus"];
  sourceTypeBreakdown: SourceTypeBreakdown[];
  placeholders: PlaceholderReadiness;
  candidateCount: number;
  evidenceCount: number;
  publicSourceCount: number;
  reviewedPositionSourceCount: number;
  consensusSourceCount: number;
  consensusSupportCount: number;
  countLabels: HomeRaceCountLabels;
  sourceStatusLabels: HomeRaceSourceStatusLabel[];
  sourceStatusLabelCounts: Record<SourceRaceCoverageStatus, number>;
  diagnostics: HomeRaceCountDiagnostics;
}

export interface HomeRaceCountLabels {
  publicSources: string;
  reviewedPositionSources: string;
  consensusSources: string;
}

export interface HomeRaceSourceStatusLabel {
  status: SourceRaceCoverageStatus;
  label: string;
  count: number;
}

export interface HomeRaceCountDiagnostics {
  raceSlug: string;
  publicSourceCount: number;
  reviewedPositionSourceCount: number;
  consensusSourceCount: number;
  consensusSupportCount: number;
}

export interface HomeRaceTotals {
  raceCount: number;
  publicSourceCount: number;
  sourceCount: number;
  reviewedPositionSourceCount: number;
  evidenceCount: number;
  candidateCount: number;
}

export interface HomePageDiagnostics {
  sectionOrder: HomeRaceSectionId[];
  sections: HomeRaceSectionDiagnostics[];
}

export interface HomeRaceSectionDiagnostics {
  sectionId: HomeRaceSectionId;
  order: number;
  raceSlugs: string[];
  publicSourceCount: number;
  reviewedPositionSourceCount: number;
  consensusSourceCount: number;
  consensusSupportCount: number;
  sourceStatusLabelCounts: Record<SourceRaceCoverageStatus, number>;
}

interface HomeRaceSectionDefinition {
  id: HomeRaceSectionId;
  title: string;
  deck: string;
}

interface DurableSourceRaceCoverageLike {
  ok: boolean;
  byRace: DurableSourceRaceCoverageRaceLike[];
  issues?: unknown[];
}

interface DurableSourceRaceCoverageRaceLike {
  raceSlug: string;
  counts: Record<SourceRaceCoverageStatus, number>;
}

const SOURCE_RACE_COVERAGE_FILENAME = "source-race-coverage.json";
const SOURCE_RACE_COVERAGE_DISPLAY_PATH = "data/public/source-race-coverage.json";

const SOURCE_RACE_COVERAGE_STATUSES: SourceRaceCoverageStatus[] = [
  "reviewed-public-position",
  "awaiting-review",
  "no-public-position-found",
  "pending-capture",
  "manual-only",
  "no-public-source-found",
  "not-applicable",
];

const SOURCE_STATUS_LABELS: Record<SourceRaceCoverageStatus, string> = {
  "reviewed-public-position": "Reviewed public position",
  "awaiting-review": "Awaiting review",
  "no-public-position-found": "Captured source/no public position",
  "pending-capture": "Pending capture",
  "manual-only": "Manual-only source",
  "no-public-source-found": "No public source found",
  "not-applicable": "Not applicable",
};

const SOURCE_STATUS_DISPLAY_ORDER: SourceRaceCoverageStatus[] = [
  "reviewed-public-position",
  "no-public-position-found",
  "pending-capture",
  "awaiting-review",
  "manual-only",
  "no-public-source-found",
  "not-applicable",
];

const SECTION_DEFINITIONS: HomeRaceSectionDefinition[] = [
  {
    id: "statewide-broader",
    title: "Statewide and broader contests",
    deck: "California executive, federal, Board of Equalization, and other non-local contests grouped before local races.",
  },
  {
    id: "local",
    title: "Local contests and measures",
    deck: "San Francisco and local legislative, executive, ballot-measure, and collection records.",
  },
];

export async function loadHomePageModel(options: LoaderOptions = {}): Promise<HomePageModel> {
  const [slugs, sourceRaceCoverageCountsBySlug] = await Promise.all([listRaceSlugs(options), loadSourceRaceCoverageCountsBySlug(options)]);
  const contexts = await Promise.all(slugs.map((slug) => loadPublicRaceContext(slug, options)));
  const races = contexts
    .filter((context): context is NonNullable<typeof context> => context !== null)
    .map((context) => {
      const sourceStatusCounts = sourceRaceCoverageCountsBySlug.get(context.race.slug);
      if (!sourceStatusCounts) {
        throw new Error(`Missing ${SOURCE_RACE_COVERAGE_DISPLAY_PATH} coverage row for public race '${context.race.slug}'.`);
      }
      return buildHomeRaceModel(buildRaceUiModel(context), sourceStatusCounts);
    })
    .sort(compareHomeRaces);
  const sections = buildHomeRaceSections(races);
  const flattenedRaces = sections.flatMap((section) => section.races);

  return {
    races: flattenedRaces,
    sections,
    totals: summarizeHomeRaces(flattenedRaces),
    diagnostics: {
      sectionOrder: sections.map((section) => section.id),
      sections: sections.map((section) => section.diagnostics),
    },
  };
}

export function buildHomeRaceModel(ui: RaceUiModel, sourceStatusCounts: Record<SourceRaceCoverageStatus, number> = emptySourceRaceCoverageStatusCounts()): HomeRaceModel {
  const publicSourceCount = ui.sourceCount;
  const reviewedPositionSourceCount = new Set(ui.positions.map((position) => position.sourceId)).size;
  const consensusSourceCount = ui.consensus.sourceCount;
  const consensusSupportCount = ui.consensus.count;
  const sourceStatusLabelCounts = copySourceStatusCounts(sourceStatusCounts);

  return {
    race: ui.race,
    consensus: ui.consensus,
    sourceTypeBreakdown: ui.sourceTypeBreakdown,
    placeholders: ui.placeholders,
    candidateCount: ui.candidates.length,
    evidenceCount: ui.evidenceCount,
    publicSourceCount,
    reviewedPositionSourceCount,
    consensusSourceCount,
    consensusSupportCount,
    countLabels: {
      publicSources: formatCountLabel(publicSourceCount, "public source"),
      reviewedPositionSources: formatCountLabel(reviewedPositionSourceCount, "reviewed-position source"),
      consensusSources: formatCountLabel(consensusSourceCount, "consensus source"),
    },
    sourceStatusLabels: formatSourceStatusLabels(sourceStatusLabelCounts),
    sourceStatusLabelCounts,
    diagnostics: {
      raceSlug: ui.race.slug,
      publicSourceCount,
      reviewedPositionSourceCount,
      consensusSourceCount,
      consensusSupportCount,
    },
  };
}

export function summarizeHomeRaces(races: HomeRaceModel[]): HomeRaceTotals {
  const publicSourceCount = races.reduce((count, race) => count + race.publicSourceCount, 0);

  return {
    raceCount: races.length,
    publicSourceCount,
    sourceCount: publicSourceCount,
    reviewedPositionSourceCount: races.reduce((count, race) => count + race.reviewedPositionSourceCount, 0),
    evidenceCount: races.reduce((count, race) => count + race.evidenceCount, 0),
    candidateCount: races.reduce((count, race) => count + race.candidateCount, 0),
  };
}

function buildHomeRaceSections(races: HomeRaceModel[]): HomeRaceSection[] {
  const racesBySection = new Map<HomeRaceSectionId, HomeRaceModel[]>(SECTION_DEFINITIONS.map((section) => [section.id, []]));
  for (const race of races) {
    racesBySection.get(classifyHomeRaceSection(race.race))?.push(race);
  }

  return SECTION_DEFINITIONS.map((definition, index) => {
    const sectionRaces = racesBySection.get(definition.id) ?? [];
    return {
      ...definition,
      races: sectionRaces,
      diagnostics: buildHomeRaceSectionDiagnostics(definition.id, index, sectionRaces),
    };
  });
}

function buildHomeRaceSectionDiagnostics(sectionId: HomeRaceSectionId, order: number, races: HomeRaceModel[]): HomeRaceSectionDiagnostics {
  return {
    sectionId,
    order,
    raceSlugs: races.map((race) => race.race.slug),
    publicSourceCount: races.reduce((count, race) => count + race.publicSourceCount, 0),
    reviewedPositionSourceCount: races.reduce((count, race) => count + race.reviewedPositionSourceCount, 0),
    consensusSourceCount: races.reduce((count, race) => count + race.consensusSourceCount, 0),
    consensusSupportCount: races.reduce((count, race) => count + race.consensusSupportCount, 0),
    sourceStatusLabelCounts: sumSourceStatusCounts(races.map((race) => race.sourceStatusLabelCounts)),
  };
}

function classifyHomeRaceSection(race: RaceUiModel["race"]): HomeRaceSectionId {
  switch (race.kind) {
    case "local-executive":
    case "local-legislative":
    case "ballot-measure":
      return "local";
    case "collection":
      return isLocalRace(race) ? "local" : "statewide-broader";
    case "statewide-executive":
    case "federal-legislative":
    case "other":
    default:
      return "statewide-broader";
  }
}

function compareHomeRaces(left: HomeRaceModel, right: HomeRaceModel): number {
  return getCivicSortRank(left.race) - getCivicSortRank(right.race) || left.race.title.localeCompare(right.race.title) || left.race.slug.localeCompare(right.race.slug);
}

function getCivicSortRank(race: RaceUiModel["race"]): number {
  if (race.slug === "california-governor") return 0;
  switch (race.kind) {
    case "statewide-executive":
      return 1;
    case "federal-legislative":
    case "other":
      return 2;
    case "collection":
      return isLocalRace(race) ? 5 : 2;
    case "local-legislative":
      return 3;
    case "ballot-measure":
      return 4;
    case "local-executive":
      return 5;
    default:
      return 6;
  }
}

function isLocalRace(race: { kind: RaceKind; jurisdiction: string; title: string }): boolean {
  const text = `${race.jurisdiction} ${race.title}`.toLowerCase();
  return text.includes("san francisco") || text.includes("sfusd") || text.includes("supervisor") || text.includes("local");
}

function formatSourceStatusLabels(counts: Record<SourceRaceCoverageStatus, number>): HomeRaceSourceStatusLabel[] {
  return SOURCE_STATUS_DISPLAY_ORDER.filter((status) => counts[status] > 0).map((status) => ({
    status,
    label: SOURCE_STATUS_LABELS[status],
    count: counts[status],
  }));
}

function sumSourceStatusCounts(countsList: Array<Record<SourceRaceCoverageStatus, number>>): Record<SourceRaceCoverageStatus, number> {
  const totals = emptySourceRaceCoverageStatusCounts();
  for (const counts of countsList) {
    for (const status of SOURCE_RACE_COVERAGE_STATUSES) totals[status] += counts[status] ?? 0;
  }
  return totals;
}

async function loadSourceRaceCoverageCountsBySlug(options: LoaderOptions): Promise<Map<string, Record<SourceRaceCoverageStatus, number>>> {
  const filePath = path.join(resolvePublicDir(options), SOURCE_RACE_COVERAGE_FILENAME);
  const report = await readSourceRaceCoverageReport(filePath);
  const countsBySlug = new Map<string, Record<SourceRaceCoverageStatus, number>>();

  report.byRace.forEach((raceCoverage, index) => {
    if (countsBySlug.has(raceCoverage.raceSlug)) {
      throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: duplicate byRace row for '${raceCoverage.raceSlug}' at byRace[${index}].`);
    }
    countsBySlug.set(raceCoverage.raceSlug, copySourceStatusCounts(raceCoverage.counts));
  });

  return countsBySlug;
}

async function readSourceRaceCoverageReport(filePath: string): Promise<DurableSourceRaceCoverageLike> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to load ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: ${formatError(error)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: ${formatError(error)}`);
  }

  if (!isRecord(json)) {
    throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: expected top-level object.`);
  }
  if (json.ok !== true) {
    const suffix = json.ok === false ? " reports ok:false" : " must include ok:true";
    throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}:${suffix}.`);
  }
  if (!Array.isArray(json.byRace)) {
    throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: expected byRace array.`);
  }

  return {
    ok: true,
    byRace: json.byRace.map(normalizeDurableRaceCoverageRow),
    issues: Array.isArray(json.issues) ? [...json.issues] : undefined,
  };
}

function normalizeDurableRaceCoverageRow(value: unknown, index: number): DurableSourceRaceCoverageRaceLike {
  if (!isRecord(value)) {
    throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: expected byRace[${index}] object.`);
  }
  if (typeof value.raceSlug !== "string" || value.raceSlug.length === 0) {
    throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: expected byRace[${index}].raceSlug string.`);
  }
  if (!isRecord(value.counts)) {
    throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: expected byRace[${index}].counts object.`);
  }
  return {
    raceSlug: value.raceSlug,
    counts: normalizeSourceStatusCounts(value.counts, `byRace[${index}].counts`),
  };
}

function normalizeSourceStatusCounts(value: Record<string, unknown>, context: string): Record<SourceRaceCoverageStatus, number> {
  const counts = emptySourceRaceCoverageStatusCounts();
  for (const status of SOURCE_RACE_COVERAGE_STATUSES) {
    const count = value[status];
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      throw new Error(`Malformed ${SOURCE_RACE_COVERAGE_DISPLAY_PATH}: expected numeric ${context}.${status}.`);
    }
    counts[status] = count;
  }
  return counts;
}

function copySourceStatusCounts(counts: Record<SourceRaceCoverageStatus, number>): Record<SourceRaceCoverageStatus, number> {
  return Object.fromEntries(SOURCE_RACE_COVERAGE_STATUSES.map((status) => [status, counts[status] ?? 0])) as Record<SourceRaceCoverageStatus, number>;
}

function resolvePublicDir(options: LoaderOptions): string {
  return options.publicDir ?? path.join(process.cwd(), "data", "public");
}

function formatCountLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
