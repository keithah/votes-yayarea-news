export type KebabCaseId = string;

export type IngestionInputKind = "html" | "text";
export type IngestionFetchStatus = "pending" | "fetched" | "failed" | "skipped";
export type IngestionImportStatus = "pending" | "imported" | "failed" | "skipped";
export type IngestionRunPhase = "manifest" | "fetch" | "clean" | "chunk" | "validate" | "write";
export type IngestionRunStatus = "pending" | "running" | "complete" | "failed";
export type IngestionArtifactStatus = "raw" | "cleaned" | "chunked" | "failed";
export type IngestionIssueSeverity = "info" | "warning" | "error";

export interface IngestionManifest {
  version: 1;
  description: string;
  targets: IngestionTarget[];
}

export interface IngestionTarget {
  id: KebabCaseId;
  sourceId: KebabCaseId;
  artifactId: KebabCaseId;
  title: string;
  inputKind: IngestionInputKind;
  fixturePath: string;
  canonicalUrl: string;
  sampleFixture: boolean;
  notes?: string;
}

export interface IngestedArtifact {
  id: KebabCaseId;
  sourceId: KebabCaseId;
  targetId: KebabCaseId;
  title: string;
  url: string;
  status: IngestionArtifactStatus;
  inputKind: IngestionInputKind;
  capturedAt?: string;
  rawPath?: string;
  cleanPath?: string;
  chunkPath?: string;
  text?: string;
  metadata?: CleanTextMetadata;
  issues?: IngestionValidationIssue[];
}

export interface CleanTextMetadata {
  inputKind: IngestionInputKind;
  originalLength: number;
  normalizedLength: number;
  removedScriptLikeBlocks: number;
  removedStyleLikeBlocks: number;
  removedBoilerplateBlocks: number;
  headingCount: number;
  lowText: boolean;
}

export interface CleanTextResult {
  text: string;
  metadata: CleanTextMetadata;
  issues: IngestionValidationIssue[];
}

export interface ArtifactChunk {
  id: KebabCaseId;
  sourceId: KebabCaseId;
  artifactId: KebabCaseId;
  order: number;
  text: string;
  startOffset: number;
  endOffset: number;
  charCount: number;
}

export interface ChunkTextOptions {
  maxChars?: number;
  minChars?: number;
}

export interface IngestionRunSummary {
  id: KebabCaseId;
  status: IngestionRunStatus;
  startedAt: string;
  completedAt?: string;
  phases: IngestionRunPhaseSummary[];
  targets: IngestionTargetSummary[];
  artifacts: IngestedArtifact[];
  counts: IngestionRunCounts;
  issues: IngestionValidationIssue[];
}

export interface IngestionRunPhaseSummary {
  phase: IngestionRunPhase;
  status: IngestionRunStatus;
  sourceId?: KebabCaseId;
  artifactId?: KebabCaseId;
  message?: string;
}

export interface IngestionTargetSummary {
  targetId: KebabCaseId;
  sourceId: KebabCaseId;
  artifactId: KebabCaseId;
  fetchStatus: IngestionFetchStatus;
  importStatus: IngestionImportStatus;
  rawPath?: string;
  cleanPath?: string;
  chunkPath?: string;
}

export interface IngestionRunCounts {
  targets: number;
  artifacts: number;
  chunks: number;
  issues: number;
  errors: number;
  warnings: number;
}

export interface IngestionValidationIssue {
  code: string;
  severity: IngestionIssueSeverity;
  path: string;
  message: string;
  sourceId?: KebabCaseId;
  artifactId?: KebabCaseId;
}

export interface IngestionValidationResult {
  ok: boolean;
  checkedFiles: string[];
  counts: IngestionRunCounts;
  issues: IngestionValidationIssue[];
}
