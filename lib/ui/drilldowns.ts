import type { LoadedPublicRaceContext } from "../data/loaders";
import type { Entity, PositionKind, Source } from "../data/types";
import {
  buildRaceReceiptsModel,
  buildRaceUiModel,
  buildRecommendationMatrixModel,
  type PublicReceiptEvidence,
  type RaceReceiptModel,
} from "./race";

export type DrilldownAvailability = "available" | "unavailable";
export type DrilldownUnavailableReason = "unknown-slug" | "no-public-positions";

export interface DrilldownRelatedRace {
  id: string;
  slug: string;
  title: string;
  electionDate: string;
  jurisdiction: string;
  positionCount: number;
  evidenceCount: number;
}

export interface DrilldownRelatedEntity {
  id: string;
  slug: string;
  name: string;
  kind: Entity["kind"];
  positionCount: number;
  evidenceCount: number;
}

export interface DrilldownRelatedSource {
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

export interface DrilldownPositionGroup {
  race: DrilldownRelatedRace;
  source: DrilldownRelatedSource;
  entity: DrilldownRelatedEntity;
  position: {
    id: string;
    kind: PositionKind;
    label: string;
    rationale?: string;
    reviewStatus: string;
    publicationStatus: string;
  };
  receipt: RaceReceiptModel;
  evidence: PublicReceiptEvidence[];
}

export interface DrilldownDiagnostics {
  requestedSlug: string;
  availability: DrilldownAvailability;
  unavailableReason?: DrilldownUnavailableReason;
  checkedRaceCount: number;
  relatedRaceCount: number;
  publicPositionCount: number;
  evidenceCount: number;
  omittedPositionCount: number;
  omittedPositions: DrilldownOmittedPosition[];
}

export interface DrilldownOmittedPosition {
  raceId: string;
  raceSlug: string;
  positionId: string;
  reason: "missing-source" | "missing-entity" | "missing-receipt";
  sourceId?: string;
  entityId?: string;
}

export interface EntityDrilldownModel {
  kind: "entity";
  slug: string;
  entity: {
    id: string;
    slug: string;
    name: string;
    kind: Entity["kind"];
    status: Entity["status"];
    description?: string;
    officialUrl?: string;
  } | null;
  availability: DrilldownAvailability;
  unavailableReason?: DrilldownUnavailableReason;
  counts: {
    relatedRaceCount: number;
    publicPositionCount: number;
    evidenceCount: number;
    sourceCount: number;
  };
  relatedRaces: DrilldownRelatedRace[];
  relatedSources: DrilldownRelatedSource[];
  positions: DrilldownPositionGroup[];
  diagnostics: DrilldownDiagnostics;
}

export interface SourceDrilldownModel {
  kind: "source";
  slug: string;
  source: {
    id: string;
    slug: string;
    name: string;
    category: string;
    sourceType: string;
    status: Source["status"];
    homepageUrl?: string;
    guideUrl?: string;
    notes?: string;
  } | null;
  availability: DrilldownAvailability;
  unavailableReason?: DrilldownUnavailableReason;
  counts: {
    relatedRaceCount: number;
    publicPositionCount: number;
    evidenceCount: number;
    entityCount: number;
  };
  relatedRaces: DrilldownRelatedRace[];
  relatedEntities: DrilldownRelatedEntity[];
  positions: DrilldownPositionGroup[];
  diagnostics: DrilldownDiagnostics;
}

export function buildEntityDrilldownModel(contexts: LoadedPublicRaceContext[], slug: string): EntityDrilldownModel {
  const records = collectEntityPositionGroups(contexts, slug);
  const entity = records.entity;
  const positions = sortPositionGroups(records.positions);
  const evidenceCount = countEvidence(positions);
  const relatedRaces = uniqueBy(positions.map((group) => group.race), (race) => race.id).sort(compareByTitleThenId);
  const relatedSources = uniqueBy(positions.map((group) => group.source), (source) => source.id).sort(compareByNameThenId);
  const availability = entity && positions.length > 0 ? "available" : "unavailable";
  const unavailableReason = availability === "available" ? undefined : entity ? "no-public-positions" : "unknown-slug";

  return {
    kind: "entity",
    slug,
    entity: entity ? pickEntity(entity) : null,
    availability,
    unavailableReason,
    counts: {
      relatedRaceCount: relatedRaces.length,
      publicPositionCount: positions.length,
      evidenceCount,
      sourceCount: relatedSources.length,
    },
    relatedRaces,
    relatedSources,
    positions,
    diagnostics: buildDiagnostics(slug, availability, unavailableReason, contexts.length, relatedRaces.length, positions.length, evidenceCount, records.omittedPositions),
  };
}

export function buildSourceDrilldownModel(contexts: LoadedPublicRaceContext[], slug: string): SourceDrilldownModel {
  const records = collectSourcePositionGroups(contexts, slug);
  const source = records.source;
  const positions = sortPositionGroups(records.positions);
  const evidenceCount = countEvidence(positions);
  const relatedRaces = uniqueBy(positions.map((group) => group.race), (race) => race.id).sort(compareByTitleThenId);
  const relatedEntities = uniqueBy(positions.map((group) => group.entity), (entity) => entity.id).sort(compareByNameThenId);
  const availability = source && positions.length > 0 ? "available" : "unavailable";
  const unavailableReason = availability === "available" ? undefined : source ? "no-public-positions" : "unknown-slug";

  return {
    kind: "source",
    slug,
    source: source ? pickSource(source) : null,
    availability,
    unavailableReason,
    counts: {
      relatedRaceCount: relatedRaces.length,
      publicPositionCount: positions.length,
      evidenceCount,
      entityCount: relatedEntities.length,
    },
    relatedRaces,
    relatedEntities,
    positions,
    diagnostics: buildDiagnostics(slug, availability, unavailableReason, contexts.length, relatedRaces.length, positions.length, evidenceCount, records.omittedPositions),
  };
}

function collectEntityPositionGroups(contexts: LoadedPublicRaceContext[], slug: string): { entity?: Entity; positions: DrilldownPositionGroup[]; omittedPositions: DrilldownOmittedPosition[] } {
  let entity: Entity | undefined;
  const positions: DrilldownPositionGroup[] = [];
  const omittedPositions: DrilldownOmittedPosition[] = [];

  for (const context of contexts) {
    const raceEntity = context.entities.find((candidate) => candidate.slug === slug);
    if (!raceEntity) continue;
    entity ??= raceEntity;
    const raceModels = buildRaceModels(context);

    for (const position of context.race.positions.filter((candidate) => candidate.entityId === raceEntity.id)) {
      const source = raceModels.sourceById.get(position.sourceId);
      const candidate = raceModels.entityById.get(position.entityId);
      if (!source || !candidate) {
        omittedPositions.push(omittedPosition(context, position.id, !source ? "missing-source" : "missing-entity", position.sourceId, position.entityId));
        continue;
      }
      const receipt = raceModels.receipts.byCellId[`cell:${position.sourceId}::${position.entityId}`];
      if (!receipt) {
        omittedPositions.push(omittedPosition(context, position.id, "missing-receipt", position.sourceId, position.entityId));
        continue;
      }
      positions.push(buildPositionGroup(context, position.id, source, candidate, receipt));
    }
  }

  return { entity, positions, omittedPositions };
}

function collectSourcePositionGroups(contexts: LoadedPublicRaceContext[], slug: string): { source?: Source; positions: DrilldownPositionGroup[]; omittedPositions: DrilldownOmittedPosition[] } {
  let source: Source | undefined;
  const positions: DrilldownPositionGroup[] = [];
  const omittedPositions: DrilldownOmittedPosition[] = [];

  for (const context of contexts) {
    const raceSource = context.sources.find((candidate) => candidate.slug === slug);
    if (!raceSource) continue;
    source ??= raceSource;
    const raceModels = buildRaceModels(context);

    for (const position of context.race.positions.filter((candidate) => candidate.sourceId === raceSource.id)) {
      const sourceCard = raceModels.sourceById.get(position.sourceId);
      const candidate = raceModels.entityById.get(position.entityId);
      if (!sourceCard || !candidate) {
        omittedPositions.push(omittedPosition(context, position.id, !sourceCard ? "missing-source" : "missing-entity", position.sourceId, position.entityId));
        continue;
      }
      const receipt = raceModels.receipts.byCellId[`cell:${position.sourceId}::${position.entityId}`];
      if (!receipt) {
        omittedPositions.push(omittedPosition(context, position.id, "missing-receipt", position.sourceId, position.entityId));
        continue;
      }
      positions.push(buildPositionGroup(context, position.id, sourceCard, candidate, receipt));
    }
  }

  return { source, positions, omittedPositions };
}

function buildRaceModels(context: LoadedPublicRaceContext) {
  const ui = buildRaceUiModel(context);
  const matrix = buildRecommendationMatrixModel(ui);
  const receipts = buildRaceReceiptsModel(ui, matrix);
  return {
    ui,
    matrix,
    receipts,
    sourceById: new Map(ui.sources.map((source) => [source.id, source])),
    entityById: new Map(ui.candidates.map((entity) => [entity.id, entity])),
  };
}

function buildPositionGroup(
  context: LoadedPublicRaceContext,
  positionId: string,
  source: DrilldownRelatedSource,
  entity: DrilldownRelatedEntity,
  receipt: RaceReceiptModel,
): DrilldownPositionGroup {
  const position = context.race.positions.find((candidate) => candidate.id === positionId);
  if (!position) throw new Error(`Invariant violation: missing public position '${positionId}' in race '${context.race.slug}'`);
  return {
    race: {
      id: context.race.id,
      slug: context.race.slug,
      title: context.race.title,
      electionDate: context.race.electionDate,
      jurisdiction: context.race.jurisdiction,
      positionCount: context.race.positions.length,
      evidenceCount: context.race.positions.reduce((count, item) => count + item.evidence.length, 0),
    },
    source,
    entity,
    position: {
      id: position.id,
      kind: position.kind,
      label: position.label,
      rationale: position.rationale,
      reviewStatus: position.status,
      publicationStatus: position.publicationStatus,
    },
    receipt,
    evidence: receipt.evidence.filter((item) => item.positionId === position.id),
  };
}

function pickEntity(entity: Entity): EntityDrilldownModel["entity"] {
  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    kind: entity.kind,
    status: entity.status,
    description: entity.description,
    officialUrl: entity.officialUrl,
  };
}

function pickSource(source: Source): SourceDrilldownModel["source"] {
  return {
    id: source.id,
    slug: source.slug,
    name: source.name,
    category: source.category,
    sourceType: source.sourceType,
    status: source.status,
    homepageUrl: source.homepageUrl,
    guideUrl: source.guideUrl,
    notes: source.notes,
  };
}

function omittedPosition(context: LoadedPublicRaceContext, positionId: string, reason: DrilldownOmittedPosition["reason"], sourceId?: string, entityId?: string): DrilldownOmittedPosition {
  return { raceId: context.race.id, raceSlug: context.race.slug, positionId, reason, sourceId, entityId };
}

function buildDiagnostics(
  requestedSlug: string,
  availability: DrilldownAvailability,
  unavailableReason: DrilldownUnavailableReason | undefined,
  checkedRaceCount: number,
  relatedRaceCount: number,
  publicPositionCount: number,
  evidenceCount: number,
  omittedPositions: DrilldownOmittedPosition[],
): DrilldownDiagnostics {
  return {
    requestedSlug,
    availability,
    unavailableReason,
    checkedRaceCount,
    relatedRaceCount,
    publicPositionCount,
    evidenceCount,
    omittedPositionCount: omittedPositions.length,
    omittedPositions,
  };
}

function sortPositionGroups(positions: DrilldownPositionGroup[]): DrilldownPositionGroup[] {
  return [...positions].sort(
    (left, right) =>
      left.race.title.localeCompare(right.race.title) ||
      left.source.name.localeCompare(right.source.name) ||
      left.entity.name.localeCompare(right.entity.name) ||
      left.position.id.localeCompare(right.position.id),
  );
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const itemKey = key(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    unique.push(item);
  }
  return unique;
}

function countEvidence(positions: DrilldownPositionGroup[]): number {
  return positions.reduce((count, position) => count + position.evidence.length, 0);
}

function compareByNameThenId<T extends { id: string; name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function compareByTitleThenId<T extends { id: string; title: string }>(left: T, right: T): number {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
