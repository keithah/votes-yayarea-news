import type { Entity, Evidence, Position, PositionKind, Race, Source, Theme } from "../data/types";

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
  text?: string;
  evidenceCount: number;
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
  if (!race.summary) return { visible: false, evidenceCount: 0 };
  return {
    visible: true,
    text: race.summary.text,
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
