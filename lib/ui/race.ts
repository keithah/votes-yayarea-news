import type { Entity, Evidence, Position, PositionKind, Race, Source, Summary, Theme } from "../data/types";

export interface PublicRaceUiInput {
  race: Race;
  sources: Source[];
  entities: Entity[];
}

export interface RaceUiModel {
  race: {
    id: string;
    slug: string;
    title: string;
    kind: Race["kind"];
    electionDate: string;
    jurisdiction: string;
  };
  candidates: RaceEntityCard[];
  sources: RaceSourceCard[];
  positions: RacePositionCard[];
  sourceCount: number;
  evidenceCount: number;
  consensus: ConsensusSnapshot;
  sourceTypeBreakdown: SourceTypeBreakdown[];
  summary: SummaryVisibility;
  themes: ThemeVisibility[];
  placeholders: PlaceholderReadiness;
}

export type RecommendationMatrixCellState = "position" | "no-public-position";
export type RecommendationMatrixFilterPositionKind = PositionKind | "no-public-position";

export interface RecommendationMatrixModel {
  raceId: string;
  raceSlug: string;
  candidates: RecommendationMatrixCandidate[];
  sources: RecommendationMatrixSource[];
  groups: RecommendationMatrixSourceGroup[];
  cells: Record<string, RecommendationMatrixCell>;
  defaultSort: RecommendationMatrixSortMetadata;
  defaultGrouping: RecommendationMatrixGroupingMetadata;
  filters: RecommendationMatrixFilterMetadata;
  empty: boolean;
}

export interface RecommendationMatrixCandidate {
  id: string;
  slug: string;
  name: string;
  positionCount: number;
  evidenceCount: number;
}

export interface RecommendationMatrixSource {
  id: string;
  slug: string;
  name: string;
  category: string;
  sourceType: string;
  positionCount: number;
  evidenceCount: number;
}

export interface RecommendationMatrixSourceGroup {
  id: string;
  sourceType: string;
  label: string;
  sourceIds: string[];
  sourceCount: number;
  positionCount: number;
  evidenceCount: number;
}

export interface RecommendationMatrixCell {
  id: string;
  key: string;
  sourceId: string;
  entityId: string;
  state: RecommendationMatrixCellState;
  positionKind?: PositionKind;
  positionKindLabel: string;
  label: string;
  positionIds: string[];
  evidenceCount: number;
  evidenceIds: string[];
  evidence: RecommendationMatrixEvidence[];
}

export interface RecommendationMatrixEvidence {
  id: string;
  sourceId: string;
  entityId?: string;
  raceId?: string;
  artifactId?: string;
  chunkId?: string;
  url: string;
  kind: Evidence["kind"];
  quote: string;
  capturedAt?: string;
}

export interface RecommendationMatrixSortMetadata {
  key: "source-type-then-name";
  label: string;
  description: string;
}

export interface RecommendationMatrixGroupingMetadata {
  key: "sourceType";
  label: string;
}

export interface RecommendationMatrixFilterMetadata {
  sourceTypes: RecommendationMatrixSourceTypeFilterOption[];
  positionKinds: RecommendationMatrixPositionKindFilterOption[];
}

export interface RecommendationMatrixSourceTypeFilterOption {
  value: string;
  label: string;
  sourceCount: number;
  cellCount: number;
}

export interface RecommendationMatrixPositionKindFilterOption {
  value: RecommendationMatrixFilterPositionKind;
  label: string;
  cellCount: number;
}

export interface RaceEntityCard {
  id: string;
  slug: string;
  name: string;
  kind: Entity["kind"];
  description?: string;
  positionCount: number;
  evidenceCount: number;
  sourceCount: number;
  countsByKind: Record<PositionKind, number>;
}

export interface RaceSourceCard {
  id: string;
  slug: string;
  name: string;
  category: string;
  sourceType: string;
  homepageUrl?: string;
  guideUrl?: string;
  positionCount: number;
  evidenceCount: number;
}

export interface RacePositionCard {
  id: string;
  entityId: string;
  sourceId: string;
  kind: PositionKind;
  status: Position["status"];
  publicationStatus: Position["publicationStatus"];
  label: string;
  rationale?: string;
  evidenceCount: number;
  evidence: Evidence[];
}

export interface ConsensusSnapshot {
  entityId?: string;
  entityName?: string;
  kind?: PositionKind;
  count: number;
  sourceCount: number;
  percentage: number;
  label: string;
}

export interface SourceTypeBreakdown {
  sourceType: string;
  sourceCount: number;
  positionCount: number;
  evidenceCount: number;
}

export interface SummaryVisibility {
  visible: boolean;
  id?: string;
  status?: Summary["status"];
  publicationStatus?: Summary["publicationStatus"];
  text?: string;
  evidenceIds: string[];
  evidenceCount: number;
}

export type RaceReceiptStatus = "available" | "unavailable";
export type RaceReceiptEmptyReason = "no-public-position" | "no-public-evidence";
export type ReviewedSummaryStatus = "available" | "unavailable";
export type ReviewedSummaryEmptyReason = "no-reviewed-summary" | "no-public-evidence";

export interface RaceReceiptCollectionModel {
  raceId: string;
  raceSlug: string;
  receiptCount: number;
  availableCount: number;
  unavailableCount: number;
  empty: boolean;
  byCellId: Record<string, RaceReceiptModel>;
}

export interface RaceReceiptModel {
  cellId: string;
  cellKey: string;
  source: RaceReceiptLabel;
  candidate: RaceReceiptLabel;
  status: RaceReceiptStatus;
  emptyReason?: RaceReceiptEmptyReason;
  position: RaceReceiptPosition;
  positionIds: string[];
  evidenceIds: string[];
  evidenceCount: number;
  evidence: PublicReceiptEvidence[];
}

export interface RaceReceiptLabel {
  id: string;
  label: string;
}

export interface RaceReceiptPosition {
  kind?: PositionKind;
  label: string;
}

export interface PublicReceiptEvidence {
  id: string;
  sourceId: string;
  entityId?: string;
  raceId?: string;
  artifactId?: string;
  chunkId?: string;
  url: string;
  kind: Evidence["kind"];
  quote: string;
  capturedAt?: string;
  source: RaceReceiptLabel;
  candidate?: RaceReceiptLabel;
  position: RaceReceiptPosition;
  positionId: string;
  reviewStatus: Position["status"];
  publicationStatus: Position["publicationStatus"];
}

export interface ReviewedSummaryEvidenceModel {
  visible: boolean;
  status: ReviewedSummaryStatus;
  emptyReason?: ReviewedSummaryEmptyReason;
  summaryId?: string;
  text?: string;
  evidenceIds: string[];
  evidenceCount: number;
  evidence: PublicReceiptEvidence[];
}

export interface ThemeVisibility {
  id: string;
  label: string;
  sentiment: Theme["sentiment"];
  evidenceCount: number;
}

export interface PlaceholderReadiness {
  hasPublicPositions: boolean;
  hasConsensusData: boolean;
  hasSourceTypeBreakdown: boolean;
  hasSummary: boolean;
  hasThemes: boolean;
  matrixReady: boolean;
  receiptsReady: boolean;
  aiDisclosureReady: boolean;
  drilldownReady: boolean;
}

const POSITION_KINDS: PositionKind[] = ["endorse", "oppose", "rank", "no-position", "informational"];
const CONSENSUS_KIND: PositionKind = "endorse";
const NO_PUBLIC_POSITION_KIND = "no-public-position" as const;

const POSITION_KIND_LABELS: Record<RecommendationMatrixFilterPositionKind, string> = {
  endorse: "Endorse",
  oppose: "Oppose",
  rank: "Ranked choice",
  "no-position": "No position",
  informational: "Informational",
  "no-public-position": "No public position",
};

export function buildRaceUiModel(input: PublicRaceUiInput): RaceUiModel {
  const race = input.race;
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const entityById = new Map(input.entities.map((entity) => [entity.id, entity]));
  const evidenceById = collectEvidenceById(race.positions);

  const positions = race.positions.map((position) => ({
    id: position.id,
    entityId: position.entityId,
    sourceId: position.sourceId,
    kind: position.kind,
    status: position.status,
    publicationStatus: position.publicationStatus,
    label: position.label,
    rationale: position.rationale,
    evidenceCount: position.evidence.length,
    evidence: position.evidence.map((evidence) => ({ ...evidence })),
  }));

  const candidates = input.entities.map((entity) => buildEntityCard(entity, race.positions));
  const sources = input.sources.map((source) => buildSourceCard(source, race.positions));
  const sourceTypeBreakdown = buildSourceTypeBreakdown(input.sources, race.positions);
  const consensus = buildConsensusSnapshot(candidates, sourceById.size);
  const summary = buildSummaryVisibility(race, evidenceById);
  const themes = buildThemeVisibility(race, evidenceById);

  return {
    race: {
      id: race.id,
      slug: race.slug,
      title: race.title,
      kind: race.kind,
      electionDate: race.electionDate,
      jurisdiction: race.jurisdiction,
    },
    candidates,
    sources,
    positions,
    sourceCount: sourceById.size,
    evidenceCount: race.positions.reduce((count, position) => count + position.evidence.length, 0),
    consensus,
    sourceTypeBreakdown,
    summary,
    themes,
    placeholders: {
      hasPublicPositions: positions.length > 0,
      hasConsensusData: consensus.count > 0,
      hasSourceTypeBreakdown: sourceTypeBreakdown.length > 0,
      hasSummary: summary.visible,
      hasThemes: themes.length > 0,
      matrixReady: positions.length > 0 && candidates.length > 0 && sources.length > 0,
      receiptsReady: positions.some((position) => position.evidenceCount > 0),
      aiDisclosureReady: true,
      drilldownReady: candidates.length > 0 || sources.length > 0,
    },
  };
}

export function buildRecommendationMatrixModel(ui: RaceUiModel): RecommendationMatrixModel {
  const candidates = ui.candidates
    .map((candidate) => ({
      id: candidate.id,
      slug: candidate.slug,
      name: candidate.name,
      positionCount: candidate.positionCount,
      evidenceCount: candidate.evidenceCount,
    }))
    .sort(compareByNameThenId);

  const sources = ui.sources
    .map((source) => ({
      id: source.id,
      slug: source.slug,
      name: source.name,
      category: source.category,
      sourceType: source.sourceType,
      positionCount: source.positionCount,
      evidenceCount: source.evidenceCount,
    }))
    .sort(compareSourcesForMatrix);

  const positionsByCellKey = groupPositionsByCellKey(ui.positions);
  const cells: Record<string, RecommendationMatrixCell> = {};

  sources.forEach((source) => {
    candidates.forEach((candidate) => {
      const key = matrixCellKey(source.id, candidate.id);
      const positions = positionsByCellKey.get(key) ?? [];
      cells[key] = buildRecommendationMatrixCell(source.id, candidate.id, positions);
    });
  });

  return {
    raceId: ui.race.id,
    raceSlug: ui.race.slug,
    candidates,
    sources,
    groups: buildRecommendationMatrixGroups(sources),
    cells,
    defaultSort: {
      key: "source-type-then-name",
      label: "Source type, then source name",
      description: "Groups rows by source type and sorts sources alphabetically within each group.",
    },
    defaultGrouping: {
      key: "sourceType",
      label: "Source type",
    },
    filters: buildRecommendationMatrixFilters(sources, candidates, cells),
    empty: candidates.length === 0 || sources.length === 0,
  };
}

export function buildRaceReceiptsModel(ui: RaceUiModel, matrix: RecommendationMatrixModel): RaceReceiptCollectionModel {
  const sourceById = new Map(ui.sources.map((source) => [source.id, source]));
  const candidateById = new Map(ui.candidates.map((candidate) => [candidate.id, candidate]));
  const positionById = new Map(ui.positions.map((position) => [position.id, position]));
  const byCellId: Record<string, RaceReceiptModel> = {};

  Object.values(matrix.cells).forEach((cell) => {
    const source = sourceById.get(cell.sourceId);
    const candidate = candidateById.get(cell.entityId);
    const primaryPosition = cell.positionIds.map((positionId) => positionById.get(positionId)).find(isDefined);
    const evidence = cell.positionIds.flatMap((positionId) => {
      const position = positionById.get(positionId);
      if (!position) return [];
      return position.evidence.map((item) => buildPublicReceiptEvidence(item, position, sourceById, candidateById));
    });
    const status: RaceReceiptStatus = cell.state === "position" && evidence.length > 0 ? "available" : "unavailable";
    const emptyReason: RaceReceiptEmptyReason | undefined =
      status === "available" ? undefined : cell.state === "no-public-position" ? "no-public-position" : "no-public-evidence";

    byCellId[cell.id] = {
      cellId: cell.id,
      cellKey: cell.key,
      source: { id: cell.sourceId, label: source?.name ?? cell.sourceId },
      candidate: { id: cell.entityId, label: candidate?.name ?? cell.entityId },
      status,
      emptyReason,
      position: {
        kind: primaryPosition?.kind,
        label: primaryPosition?.label ?? cell.positionKindLabel,
      },
      positionIds: [...cell.positionIds],
      evidenceIds: [...cell.evidenceIds],
      evidenceCount: evidence.length,
      evidence,
    };
  });

  const receipts = Object.values(byCellId);
  const availableCount = receipts.filter((receipt) => receipt.status === "available").length;
  const unavailableCount = receipts.length - availableCount;

  return {
    raceId: ui.race.id,
    raceSlug: ui.race.slug,
    receiptCount: receipts.length,
    availableCount,
    unavailableCount,
    empty: receipts.length === 0,
    byCellId,
  };
}

export function buildRaceReviewedSummaryModel(ui: RaceUiModel): ReviewedSummaryEvidenceModel {
  if (!ui.summary.visible || ui.summary.status !== "reviewed" || ui.summary.publicationStatus !== "public") {
    return {
      visible: false,
      status: "unavailable",
      emptyReason: "no-reviewed-summary",
      evidenceIds: ui.summary.evidenceIds ?? [],
      evidenceCount: 0,
      evidence: [],
    };
  }

  const evidenceById = buildPublicReceiptEvidenceById(ui);
  const evidence = ui.summary.evidenceIds.map((evidenceId) => evidenceById.get(evidenceId)).filter(isDefined);

  return {
    visible: true,
    status: evidence.length > 0 ? "available" : "unavailable",
    emptyReason: evidence.length > 0 ? undefined : "no-public-evidence",
    summaryId: ui.summary.id,
    text: ui.summary.text,
    evidenceIds: [...ui.summary.evidenceIds],
    evidenceCount: evidence.length,
    evidence,
  };
}

function buildPublicReceiptEvidenceById(ui: RaceUiModel): Map<string, PublicReceiptEvidence> {
  const sourceById = new Map(ui.sources.map((source) => [source.id, source]));
  const candidateById = new Map(ui.candidates.map((candidate) => [candidate.id, candidate]));
  return new Map(
    ui.positions.flatMap((position) => position.evidence.map((evidence) => [evidence.id, buildPublicReceiptEvidence(evidence, position, sourceById, candidateById)] as const)),
  );
}

function buildPublicReceiptEvidence(
  evidence: Evidence,
  position: RacePositionCard,
  sourceById: Map<string, RaceSourceCard>,
  candidateById: Map<string, RaceEntityCard>,
): PublicReceiptEvidence {
  const source = sourceById.get(evidence.sourceId);
  const candidate = evidence.entityId ? candidateById.get(evidence.entityId) : undefined;
  return {
    ...evidence,
    source: { id: evidence.sourceId, label: source?.name ?? evidence.sourceId },
    candidate: evidence.entityId ? { id: evidence.entityId, label: candidate?.name ?? evidence.entityId } : undefined,
    position: { kind: position.kind, label: position.label },
    positionId: position.id,
    reviewStatus: position.status,
    publicationStatus: position.publicationStatus,
  };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function groupPositionsByCellKey(positions: RacePositionCard[]): Map<string, RacePositionCard[]> {
  return positions.reduce<Map<string, RacePositionCard[]>>((groups, position) => {
    const key = matrixCellKey(position.sourceId, position.entityId);
    const group = groups.get(key) ?? [];
    group.push(position);
    group.sort((left, right) => left.id.localeCompare(right.id));
    groups.set(key, group);
    return groups;
  }, new Map());
}

function buildRecommendationMatrixCell(sourceId: string, entityId: string, positions: RacePositionCard[]): RecommendationMatrixCell {
  const key = matrixCellKey(sourceId, entityId);
  if (positions.length === 0) {
    return {
      id: `cell:${key}`,
      key,
      sourceId,
      entityId,
      state: "no-public-position",
      positionKindLabel: POSITION_KIND_LABELS[NO_PUBLIC_POSITION_KIND],
      label: POSITION_KIND_LABELS[NO_PUBLIC_POSITION_KIND],
      positionIds: [],
      evidenceCount: 0,
      evidenceIds: [],
      evidence: [],
    };
  }

  const primaryPosition = positions[0];
  const evidence = positions.flatMap((position) => position.evidence).map((item) => ({ ...item }));

  return {
    id: `cell:${key}`,
    key,
    sourceId,
    entityId,
    state: "position",
    positionKind: primaryPosition.kind,
    positionKindLabel: POSITION_KIND_LABELS[primaryPosition.kind],
    label: primaryPosition.label,
    positionIds: positions.map((position) => position.id),
    evidenceCount: evidence.length,
    evidenceIds: evidence.map((item) => item.id),
    evidence,
  };
}

function buildRecommendationMatrixGroups(sources: RecommendationMatrixSource[]): RecommendationMatrixSourceGroup[] {
  const bySourceType = sources.reduce<Map<string, RecommendationMatrixSourceGroup>>((groups, source) => {
    const existing = groups.get(source.sourceType) ?? {
      id: `source-type:${slugifyMatrixId(source.sourceType)}`,
      sourceType: source.sourceType,
      label: source.sourceType,
      sourceIds: [],
      sourceCount: 0,
      positionCount: 0,
      evidenceCount: 0,
    };
    existing.sourceIds.push(source.id);
    existing.sourceCount += 1;
    existing.positionCount += source.positionCount;
    existing.evidenceCount += source.evidenceCount;
    groups.set(source.sourceType, existing);
    return groups;
  }, new Map());

  return Array.from(bySourceType.values()).sort((left, right) => left.sourceType.localeCompare(right.sourceType));
}

function buildRecommendationMatrixFilters(
  sources: RecommendationMatrixSource[],
  candidates: RecommendationMatrixCandidate[],
  cells: Record<string, RecommendationMatrixCell>,
): RecommendationMatrixFilterMetadata {
  const sourceTypes = buildSourceTypeFilterOptions(sources, candidates.length);
  const positionKindCounts = new Map<RecommendationMatrixFilterPositionKind, number>();

  Object.values(cells).forEach((cell) => {
    const kind = cell.positionKind ?? NO_PUBLIC_POSITION_KIND;
    positionKindCounts.set(kind, (positionKindCounts.get(kind) ?? 0) + 1);
  });

  const positionKinds = ([...POSITION_KINDS, NO_PUBLIC_POSITION_KIND] as RecommendationMatrixFilterPositionKind[])
    .filter((value) => positionKindCounts.has(value))
    .map((value) => ({ value, label: POSITION_KIND_LABELS[value], cellCount: positionKindCounts.get(value) ?? 0 }));

  return { sourceTypes, positionKinds };
}

function buildSourceTypeFilterOptions(sources: RecommendationMatrixSource[], candidateCount: number): RecommendationMatrixSourceTypeFilterOption[] {
  const bySourceType = sources.reduce<Map<string, RecommendationMatrixSourceTypeFilterOption>>((options, source) => {
    const existing = options.get(source.sourceType) ?? {
      value: source.sourceType,
      label: source.sourceType,
      sourceCount: 0,
      cellCount: 0,
    };
    existing.sourceCount += 1;
    existing.cellCount += candidateCount;
    options.set(source.sourceType, existing);
    return options;
  }, new Map());

  return Array.from(bySourceType.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function matrixCellKey(sourceId: string, entityId: string): string {
  return `${sourceId}::${entityId}`;
}

function compareByNameThenId<T extends { id: string; name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function compareSourcesForMatrix(left: RecommendationMatrixSource, right: RecommendationMatrixSource): number {
  return left.sourceType.localeCompare(right.sourceType) || compareByNameThenId(left, right);
}

function slugifyMatrixId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildEntityCard(entity: Entity, positions: Position[]): RaceEntityCard {
  const entityPositions = positions.filter((position) => position.entityId === entity.id);
  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    kind: entity.kind,
    description: entity.description,
    positionCount: entityPositions.length,
    evidenceCount: entityPositions.reduce((count, position) => count + position.evidence.length, 0),
    sourceCount: new Set(entityPositions.map((position) => position.sourceId)).size,
    countsByKind: countDistinctSourcesByPositionKind(entityPositions),
  };
}

function buildSourceCard(source: Source, positions: Position[]): RaceSourceCard {
  const sourcePositions = positions.filter((position) => position.sourceId === source.id);
  return {
    id: source.id,
    slug: source.slug,
    name: source.name,
    category: source.category,
    sourceType: source.sourceType,
    homepageUrl: source.homepageUrl,
    guideUrl: source.guideUrl,
    positionCount: sourcePositions.length,
    evidenceCount: sourcePositions.reduce((count, position) => count + position.evidence.length, 0),
  };
}

function countDistinctSourcesByPositionKind(positions: Position[]): Record<PositionKind, number> {
  const sourceIdsByKind = Object.fromEntries(POSITION_KINDS.map((kind) => [kind, new Set<string>()])) as Record<PositionKind, Set<string>>;
  positions.forEach((position) => sourceIdsByKind[position.kind].add(position.sourceId));
  return Object.fromEntries(POSITION_KINDS.map((kind) => [kind, sourceIdsByKind[kind].size])) as Record<PositionKind, number>;
}

function buildConsensusSnapshot(candidates: RaceEntityCard[], sourceCount: number): ConsensusSnapshot {
  if (sourceCount === 0) {
    return { count: 0, sourceCount, percentage: 0, label: "No public sources" };
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, count: candidate.countsByKind[CONSENSUS_KIND] }))
    .sort((left, right) => right.count - left.count || left.candidate.name.localeCompare(right.candidate.name));
  const leader = ranked[0];
  if (!leader || leader.count === 0) {
    return { count: 0, sourceCount, percentage: 0, label: "No public endorsements" };
  }

  return {
    entityId: leader.candidate.id,
    entityName: leader.candidate.name,
    kind: CONSENSUS_KIND,
    count: leader.count,
    sourceCount,
    percentage: Math.round((leader.count / sourceCount) * 100),
    label: `${leader.count} of ${sourceCount} public sources endorse ${leader.candidate.name}`,
  };
}

function buildSourceTypeBreakdown(sources: Source[], positions: Position[]): SourceTypeBreakdown[] {
  const breakdownByType = sources
    .map((source) => {
      const sourcePositions = positions.filter((position) => position.sourceId === source.id);
      return {
        sourceType: source.sourceType,
        positionCount: sourcePositions.length,
        evidenceCount: sourcePositions.reduce((count, position) => count + position.evidence.length, 0),
      };
    })
    .reduce<Map<string, SourceTypeBreakdown>>((breakdown, entry) => {
      const existing = breakdown.get(entry.sourceType) ?? {
        sourceType: entry.sourceType,
        sourceCount: 0,
        positionCount: 0,
        evidenceCount: 0,
      };
      existing.sourceCount += 1;
      existing.positionCount += entry.positionCount;
      existing.evidenceCount += entry.evidenceCount;
      breakdown.set(entry.sourceType, existing);
      return breakdown;
    }, new Map());

  return Array.from(breakdownByType.values()).sort((left, right) => left.sourceType.localeCompare(right.sourceType));
}

function buildSummaryVisibility(race: Race, evidenceById: Map<string, Evidence>): SummaryVisibility {
  if (!race.summary) return { visible: false, evidenceIds: [], evidenceCount: 0 };
  return {
    visible: true,
    id: race.summary.id,
    status: race.summary.status,
    publicationStatus: race.summary.publicationStatus,
    text: race.summary.text,
    evidenceIds: [...race.summary.evidenceIds],
    evidenceCount: countKnownEvidenceIds(race.summary.evidenceIds, evidenceById),
  };
}

function buildThemeVisibility(race: Race, evidenceById: Map<string, Evidence>): ThemeVisibility[] {
  return (race.themes ?? []).map((theme) => ({
    id: theme.id,
    label: theme.label,
    sentiment: theme.sentiment,
    evidenceCount: countKnownEvidenceIds(theme.evidenceIds, evidenceById),
  }));
}

function collectEvidenceById(positions: Position[]): Map<string, Evidence> {
  return new Map(positions.flatMap((position) => position.evidence.map((evidence) => [evidence.id, evidence] as const)));
}

function countKnownEvidenceIds(evidenceIds: string[], evidenceById: Map<string, Evidence>): number {
  return evidenceIds.filter((evidenceId) => evidenceById.has(evidenceId)).length;
}
