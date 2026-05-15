import type {
  EvidenceKind,
  PositionKind,
  PublicationStatus,
  PublicDataRepository,
  ReviewStatus,
} from "../data/types";
import type { ArtifactChunk, IngestedArtifact, KebabCaseId } from "../ingestion/types";

export type ExtractionIssueSeverity = "info" | "warning" | "error";
export type ExtractionRunStatus = "pending" | "running" | "complete" | "failed";
export type ExtractionReviewStatus = "generated" | "needs-review" | "reviewed" | "verified" | "published" | "rejected";

export interface ExtractionProviderMetadata {
  provider: string;
  model: string;
  requestId?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ExtractionManifest {
  version: 1;
  description: string;
  provider: ExtractionProviderMetadata;
  inputs: ExtractionPromptInput[];
}

export interface ExtractionPromptInput {
  id: KebabCaseId;
  raceId: KebabCaseId;
  sourceId: KebabCaseId;
  artifactId: KebabCaseId;
  chunkIds: KebabCaseId[];
  instructions?: string;
}

export interface DraftEvidence {
  id: KebabCaseId;
  positionId: KebabCaseId;
  raceId: KebabCaseId;
  sourceId: KebabCaseId;
  entityId?: KebabCaseId;
  artifactId: KebabCaseId;
  chunkId: KebabCaseId;
  url: string;
  kind: EvidenceKind;
  quote: string;
}

export interface DraftPosition {
  id: KebabCaseId;
  raceId: KebabCaseId;
  sourceId: KebabCaseId;
  entityId: KebabCaseId;
  kind: PositionKind;
  reviewStatus: ExtractionReviewStatus;
  publicationStatus: PublicationStatus;
  label: string;
  rationale?: string;
  evidenceIds: KebabCaseId[];
  publicReady?: boolean;
  generatedBy?: ExtractionProviderMetadata;
  generatedAt?: string;
  manualOverride?: DraftManualOverride;
}

export interface DraftManualOverride {
  reviewer: string;
  reviewedAt: string;
  status: ReviewStatus;
  publicationStatus: PublicationStatus;
  notes?: string;
}

export interface ExtractionDraft {
  version: 1;
  runId: KebabCaseId;
  provider: ExtractionProviderMetadata;
  positions: DraftPosition[];
  evidence: DraftEvidence[];
}

export interface ExtractionRunCounts {
  inputs: number;
  positions: number;
  evidence: number;
  issues: number;
  errors: number;
  warnings: number;
}

export interface ExtractionRunSummary {
  id: KebabCaseId;
  status: ExtractionRunStatus;
  provider: ExtractionProviderMetadata;
  startedAt: string;
  completedAt?: string;
  inputs: ExtractionPromptInput[];
  counts: ExtractionRunCounts;
  outputPath?: string;
  validationPath?: string;
  issues: ExtractionValidationIssue[];
}

export interface ExtractionValidationIssue {
  code: string;
  severity: ExtractionIssueSeverity;
  path: string;
  message: string;
  sourceId?: KebabCaseId;
  artifactId?: KebabCaseId;
  chunkId?: KebabCaseId;
  raceId?: KebabCaseId;
  entityId?: KebabCaseId;
}

export interface ExtractionValidationReport {
  ok: boolean;
  checkedFiles: string[];
  counts: ExtractionRunCounts;
  issues: ExtractionValidationIssue[];
}

export interface ExtractionValidationContext {
  publicData: PublicDataRepository;
  artifacts: IngestedArtifact[];
  chunks: ArtifactChunk[];
  checkedFiles?: string[];
}
