import { promises as fs } from "node:fs";
import path from "node:path";
import { loadRaceData } from "../data/loaders";
import type { ArtifactChunk, IngestedArtifact } from "../ingestion/types";
import { assembleExtractionPrompts, EXTRACTION_PROMPT_VERSION } from "./prompt";
import { createProvider, ExtractionProviderError, type ExtractionProvider, type ProviderPosition } from "./provider";
import type { DraftEvidence, DraftPosition, ExtractionDraft, ExtractionProviderMetadata, ExtractionRunSummary, ExtractionValidationContext, ExtractionValidationIssue, ExtractionValidationReport } from "./types";
import { validateExtractionDraft } from "./validate";

export interface RunExtractionOptions {
  manifestPath?: string;
  outDir?: string;
  provider?: string;
  model?: string;
  raceSlug?: string;
  dryRun?: boolean;
  promptPreview?: boolean;
  maxChunkChars?: number;
  providerImpl?: ExtractionProvider;
  now?: () => Date;
}

export interface ValidatePersistedExtractionOptions {
  draftPath?: string;
  validationPath?: string;
  manifestPath?: string;
  raceSlug?: string;
}

export interface ExtractionRunResult {
  draft: ExtractionDraft;
  run: ExtractionRunSummary & { promptVersion: string; durationMs: number; promptPreviews?: Array<{ inputId: string; prompt: string }>; phases: Array<{ inputId: string; status: string; issueCodes: string[] }> };
  validation: ExtractionValidationReport;
}

const DEFAULT_MANIFEST = path.join(process.cwd(), "data", "ingestion", "manifest.json");
const DEFAULT_OUT_DIR = path.join(process.cwd(), "data", "extracted");

export async function runExtraction(options: RunExtractionOptions = {}): Promise<ExtractionRunResult> {
  const now = options.now ?? (() => new Date());
  const started = now();
  const providerName = options.provider ?? "openai";
  const model = options.model ?? (providerName === "fixture" ? "fixture-v1" : "gpt-4o-mini");
  const providerMetadata: ExtractionProviderMetadata = { provider: providerName, model };
  const runId = `run-${started.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const outDir = options.outDir ?? DEFAULT_OUT_DIR;
  const draftPath = path.join(outDir, "drafts", "latest.json");
  const runPath = path.join(outDir, "runs", "latest.json");
  const validationPath = path.join(outDir, "validation", "latest.json");

  const assembly = await assembleExtractionPrompts({ manifestPath: options.manifestPath ?? DEFAULT_MANIFEST, raceSlug: options.raceSlug, maxChunkChars: options.maxChunkChars });
  const issues: ExtractionValidationIssue[] = [...assembly.issues];
  const positions: DraftPosition[] = [];
  const evidence: DraftEvidence[] = [];
  const phases: ExtractionRunResult["run"]["phases"] = [];
  const provider = options.providerImpl ?? createProvider(providerName, { model });

  if (!options.dryRun && issues.filter((issue) => issue.severity === "error").length === 0) {
    for (const target of assembly.targets) {
      const phaseIssues: ExtractionValidationIssue[] = [];
      try {
        const response = await provider.complete({ prompt: target.prompt, metadata: providerMetadata });
        if (response.requestId) providerMetadata.requestId = response.requestId;
        convertProviderPositions(response.positions, { provider: providerMetadata, runId, target, generatedAt: started.toISOString(), positions, evidence });
      } catch (error) {
        const issue = providerIssue(error);
        phaseIssues.push(issue);
        issues.push({ ...issue, path: `${target.input.id}.${issue.path}`, sourceId: target.input.sourceId, artifactId: target.input.artifactId, raceId: target.input.raceId });
      }
      phases.push({ inputId: target.input.id, status: phaseIssues.length > 0 ? "failed" : "complete", issueCodes: phaseIssues.map((issue) => issue.code) });
    }
  } else {
    for (const target of assembly.targets) phases.push({ inputId: target.input.id, status: options.dryRun ? "dry-run" : "skipped", issueCodes: [] });
  }

  const draft: ExtractionDraft = { version: 1, runId, provider: providerMetadata, positions, evidence };
  const context: ExtractionValidationContext = { publicData: assembly.publicData, artifacts: assembly.artifacts, chunks: assembly.chunks, checkedFiles: assembly.checkedFiles };
  const validation = validateExtractionDraft(draft, context);
  validation.issues.push(...issues);
  validation.issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  validation.counts = countRun(assembly.targets.length, positions.length, evidence.length, validation.issues);
  validation.ok = validation.counts.errors === 0;

  const completed = now();
  const run = {
    id: runId,
    status: validation.ok && !options.dryRun ? "complete" : validation.ok && options.dryRun ? "complete" : "failed",
    provider: providerMetadata,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: Math.max(0, completed.getTime() - started.getTime()),
    inputs: assembly.targets.map((target) => target.input),
    counts: validation.counts,
    outputPath: relative(draftPath),
    validationPath: relative(validationPath),
    issues: validation.issues,
    phases,
    ...(options.promptPreview ? { promptPreviews: assembly.targets.map((target) => ({ inputId: target.input.id, prompt: target.prompt })) } : {}),
  } satisfies ExtractionRunResult["run"];

  await writeJson(draftPath, draft);
  await writeJson(validationPath, validation);
  await writeJson(runPath, run);
  return { draft, run, validation };
}

export async function validatePersistedExtraction(options: ValidatePersistedExtractionOptions = {}): Promise<ExtractionValidationReport> {
  const draftPath = options.draftPath ?? path.join(DEFAULT_OUT_DIR, "drafts", "latest.json");
  const validationPath = options.validationPath ?? path.join(DEFAULT_OUT_DIR, "validation", "latest.json");
  const checkedFiles: string[] = [relative(draftPath)];
  const issues: ExtractionValidationIssue[] = [];
  let draft: ExtractionDraft | undefined;
  try {
    draft = JSON.parse(await fs.readFile(draftPath, "utf8")) as ExtractionDraft;
  } catch (error) {
    issues.push({ code: error instanceof SyntaxError ? "malformed_json" : "missing_input_file", severity: "error", path: relative(draftPath), message: formatError(error) });
  }
  const assembly = await assembleExtractionPrompts({ manifestPath: options.manifestPath ?? DEFAULT_MANIFEST, raceSlug: options.raceSlug });
  const report = draft ? validateExtractionDraft(draft, { publicData: assembly.publicData, artifacts: assembly.artifacts, chunks: assembly.chunks, checkedFiles: [...checkedFiles, ...assembly.checkedFiles] }) : { ok: false, checkedFiles, counts: countRun(0, 0, 0, issues), issues };
  report.issues.push(...assembly.issues, ...issues);
  report.issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
  report.counts = countRun(report.counts.inputs, report.counts.positions, report.counts.evidence, report.issues);
  report.ok = report.counts.errors === 0;
  await writeJson(validationPath, report);
  return report;
}

async function convertProviderPositions(rawPositions: ProviderPosition[], args: { provider: ExtractionProviderMetadata; runId: string; target: { input: { raceId: string; sourceId: string; artifactId: string }; artifact: IngestedArtifact; chunks: ArtifactChunk[] }; generatedAt: string; positions: DraftPosition[]; evidence: DraftEvidence[] }): Promise<void> {
  rawPositions.forEach((rawPosition, positionIndex) => {
    const positionId = `pos-${args.target.input.sourceId.replace(/^src-/, "")}-${rawPosition.entityId.replace(/^ent-/, "")}-${positionIndex + 1}`;
    const evidenceIds: string[] = [];
    (rawPosition.evidence ?? []).forEach((rawEvidence, evidenceIndex) => {
      const evidenceId = `ev-${positionId.replace(/^pos-/, "")}-${evidenceIndex + 1}`;
      evidenceIds.push(evidenceId);
      args.evidence.push({ id: evidenceId, positionId, raceId: args.target.input.raceId, sourceId: args.target.input.sourceId, entityId: rawPosition.entityId, artifactId: args.target.input.artifactId, chunkId: rawEvidence.chunkId, url: args.target.artifact.url, kind: rawEvidence.kind ?? "quote", quote: rawEvidence.quote });
    });
    args.positions.push({ id: positionId, raceId: args.target.input.raceId, sourceId: args.target.input.sourceId, entityId: rawPosition.entityId, kind: rawPosition.kind, reviewStatus: "generated", publicationStatus: "hidden", label: rawPosition.label, rationale: rawPosition.rationale, evidenceIds, generatedBy: args.provider, generatedAt: args.generatedAt });
  });
}

export async function raceSlugExists(slug: string): Promise<boolean> {
  return (await loadRaceData(slug)) !== null;
}

function providerIssue(error: unknown): ExtractionValidationIssue {
  if (error instanceof ExtractionProviderError) return error.issue;
  return { code: "provider_error", severity: "error", path: "provider", message: formatError(error) };
}

function countRun(inputs: number, positions: number, evidence: number, issues: ExtractionValidationIssue[]) {
  return { inputs, positions, evidence, issues: issues.length, errors: issues.filter((issue) => issue.severity === "error").length, warnings: issues.filter((issue) => issue.severity === "warning").length };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]") : String(error);
}

function relative(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}
