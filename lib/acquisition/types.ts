import type { IngestionManifest } from "../ingestion/types";

export type AcquisitionPhase = "candidate" | "fetch" | "capture" | "manifest" | "validate";
export type AcquisitionStatus =
  | "captured"
  | "skipped"
  | "http_error"
  | "timeout"
  | "unsupported_content"
  | "low_text"
  | "invalid_candidate"
  | "invalid_source";

export interface AcquisitionCandidate {
  sourceId: string;
  url: string;
  title?: string;
  kind?: string;
  discoveredAt?: string;
  fixtureName?: string;
  notes?: string;
}

export interface AcquisitionDiagnostic {
  sourceId: string;
  phase: AcquisitionPhase;
  status: AcquisitionStatus;
  attemptedUrl?: string;
  capturedArtifactPath?: string;
  skippedReason?: string;
  error?: { code: string; message: string };
  timestamp: string;
  manifestIncluded: boolean;
  path?: string;
}

export interface AcquisitionLatestReport {
  version: 1;
  generatedAt: string;
  sourcesPath: string;
  candidatesPath: string;
  manifestPath: string;
  counts: {
    sources: number;
    candidates: number;
    captured: number;
    manifestTargets: number;
    diagnostics: number;
    errors: number;
  };
  diagnostics: AcquisitionDiagnostic[];
}

export interface AcquireSourcesOptions {
  sourcesPath: string;
  candidatesPath: string;
  acquisitionDir: string;
  manifestPath: string;
  allowNetwork?: boolean;
  fetchTimeoutMs?: number;
  maxCandidateBytes?: number;
  maxSources?: number;
  minTextLength?: number;
  now?: () => Date;
}

export interface AcquisitionResult {
  ok: boolean;
  diagnostics: AcquisitionDiagnostic[];
  manifest?: IngestionManifest;
  reportPath?: string;
}
