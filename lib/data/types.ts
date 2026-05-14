export type ReviewStatus = "draft" | "reviewed" | "verified" | "published" | "rejected";
export type PublicationStatus = "hidden" | "public" | "archived";
export type SourceStatus = "pending" | "active" | "excluded" | "archived";
export type ArtifactStatus = "pending" | "fetched" | "parsed" | "reviewed" | "rejected";
export type EntityKind = "candidate" | "measure" | "office" | "organization" | "person" | "other";
export type CollectionKind = "race" | "ballot-measure-collection" | "office-group" | "topic";
export type RaceKind = "local-executive" | "local-legislative" | "statewide-executive" | "federal-legislative" | "ballot-measure" | "collection" | "other";
export type PositionKind = "endorse" | "oppose" | "rank" | "no-position" | "informational";
export type EvidenceKind = "quote" | "snippet" | "summary" | "link";
export type ThemeSentiment = "support" | "concern" | "neutral";

export interface Source {
  id: string;
  slug: string;
  name: string;
  category: string;
  sourceType: string;
  status: SourceStatus;
  homepageUrl?: string;
  guideUrl?: string;
  notes?: string;
  sampleFixture?: boolean;
}

export interface Artifact {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  status: ArtifactStatus;
  publishedAt?: string;
  fetchedAt?: string;
  chunks?: ArtifactChunk[];
}

export interface ArtifactChunk {
  id: string;
  artifactId: string;
  sourceId: string;
  text: string;
  order: number;
  embeddingId?: string;
}

export interface Entity {
  id: string;
  slug: string;
  name: string;
  kind: EntityKind;
  status: ReviewStatus;
  description?: string;
  officialUrl?: string;
  sampleFixture?: boolean;
}

export interface Collection {
  id: string;
  slug: string;
  title: string;
  kind: CollectionKind;
  status: ReviewStatus;
  description?: string;
  raceIds: string[];
}

export interface Race {
  id: string;
  slug: string;
  title: string;
  kind: RaceKind;
  status: ReviewStatus;
  publicationStatus: PublicationStatus;
  electionDate: string;
  jurisdiction: string;
  entityIds: string[];
  sourceIds: string[];
  positions: Position[];
  themes?: Theme[];
  summary?: Summary;
  sampleFixture?: boolean;
}

export interface Position {
  id: string;
  raceId: string;
  sourceId: string;
  entityId: string;
  kind: PositionKind;
  status: ReviewStatus;
  publicationStatus: PublicationStatus;
  label: string;
  rationale?: string;
  evidenceIds: string[];
  evidence: Evidence[];
}

export interface Evidence {
  id: string;
  sourceId: string;
  entityId?: string;
  raceId?: string;
  artifactId?: string;
  url: string;
  kind: EvidenceKind;
  quote: string;
  capturedAt?: string;
}

export interface Theme {
  id: string;
  label: string;
  sentiment: ThemeSentiment;
  evidenceIds: string[];
}

export interface Summary {
  id: string;
  status: ReviewStatus;
  publicationStatus: PublicationStatus;
  text: string;
  evidenceIds: string[];
}

export interface Embedding {
  id: string;
  ownerType: "artifact-chunk" | "evidence" | "summary";
  ownerId: string;
  model: string;
  dimensions: number;
  vector?: number[];
}

export interface ExtractionRun {
  id: string;
  sourceId: string;
  artifactId?: string;
  status: "pending" | "running" | "complete" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface PublicDataRepository {
  sources: Source[];
  entities: Entity[];
  collections: Collection[];
  races: Race[];
}
