import { promises as fs } from "node:fs";
import path from "node:path";
import type { PublicDataRepository } from "../data/types";
import type { ArtifactChunk, IngestedArtifact, IngestionManifest } from "../ingestion/types";
import type { ExtractionPromptInput, ExtractionValidationIssue } from "./types";

export const EXTRACTION_PROMPT_VERSION = "position-extraction-v1";
const MIN_CHUNK_CHARS = 80;
const DEFAULT_MAX_CHUNK_CHARS = 12_000;

export interface PromptAssemblyOptions {
  manifestPath: string;
  raceSlug?: string;
  publicDir?: string;
  maxChunkChars?: number;
}

export interface ExtractionPromptTarget {
  input: ExtractionPromptInput;
  prompt: string;
  artifact: IngestedArtifact;
  chunks: ArtifactChunk[];
}

export interface PromptAssemblyResult {
  publicData: PublicDataRepository;
  artifacts: IngestedArtifact[];
  chunks: ArtifactChunk[];
  targets: ExtractionPromptTarget[];
  checkedFiles: string[];
  issues: ExtractionValidationIssue[];
}

export async function assembleExtractionPrompts(options: PromptAssemblyOptions): Promise<PromptAssemblyResult> {
  const checkedFiles: string[] = [];
  const issues: ExtractionValidationIssue[] = [];
  const manifest = await readJson<IngestionManifest>(options.manifestPath, checkedFiles, issues, "manifest");
  const publicData = await loadPublicData(options.publicDir ?? path.join(process.cwd(), "data", "public"), checkedFiles, issues);

  const artifacts: IngestedArtifact[] = [];
  const chunks: ArtifactChunk[] = [];
  const targets: ExtractionPromptTarget[] = [];
  const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;

  if (!manifest || !Array.isArray(manifest.targets)) {
    addIssue(issues, "invalid_manifest", "error", relative(options.manifestPath), "Manifest must include a targets array.");
    return { publicData, artifacts, chunks, targets, checkedFiles, issues };
  }

  const raceCandidates = options.raceSlug ? publicData.races.filter((race) => race.slug === options.raceSlug) : publicData.races;
  if (options.raceSlug && raceCandidates.length === 0) {
    addIssue(issues, "unknown_race_slug", "error", "raceSlug", `Race slug '${options.raceSlug}' does not exist.`);
  }

  for (const target of manifest.targets) {
    const targetPath = `targets.${target.id}`;
    const matchingRaces = raceCandidates.filter((candidate) => candidate.sourceIds.includes(target.sourceId));
    if (matchingRaces.length === 0) continue;

    const artifactPath = path.join(process.cwd(), "data", "ingested", "artifacts", `${stripArtifactPrefix(target.artifactId)}.json`);
    const chunkPath = path.join(process.cwd(), "data", "ingested", "chunks", `${stripArtifactPrefix(target.artifactId)}.json`);
    const artifact = await readJson<IngestedArtifact>(artifactPath, checkedFiles, issues, `${targetPath}.artifact`);
    const artifactChunks = await readJson<ArtifactChunk[]>(chunkPath, checkedFiles, issues, `${targetPath}.chunks`);
    if (!artifact || !Array.isArray(artifactChunks)) continue;

    artifacts.push(artifact);
    chunks.push(...artifactChunks);

    const usableChunks = artifactChunks.filter((chunk, index) => {
      const textLength = chunk.text?.trim().length ?? 0;
      if (textLength < MIN_CHUNK_CHARS) {
        addIssue(issues, "low_text_chunk", "warning", `${relative(chunkPath)}[${index}].text`, "Chunk text is too short for extraction and will be skipped.", { sourceId: chunk.sourceId, artifactId: chunk.artifactId, chunkId: chunk.id });
        return false;
      }
      if (textLength > maxChunkChars) {
        addIssue(issues, "oversized_chunk", "error", `${relative(chunkPath)}[${index}].text`, `Chunk text exceeds maxChunkChars=${maxChunkChars}.`, { sourceId: chunk.sourceId, artifactId: chunk.artifactId, chunkId: chunk.id });
        return false;
      }
      return true;
    });
    if (usableChunks.length === 0) continue;

    for (const race of matchingRaces) {
      const input: ExtractionPromptInput = {
        id: `input-${race.slug}-${target.sourceId}`,
        raceId: race.id,
        sourceId: target.sourceId,
        artifactId: artifact.id,
        chunkIds: usableChunks.map((chunk) => chunk.id),
        instructions: "Return strict JSON only. Do not infer facts without an exact quote from a provided chunk.",
      };
      targets.push({ input, prompt: buildExtractionPrompt({ publicData, raceId: race.id, sourceId: target.sourceId, artifact, chunks: usableChunks }), artifact, chunks: usableChunks });
    }
  }

  return { publicData, artifacts, chunks, targets, checkedFiles, issues };
}

export function buildExtractionPrompt(args: { publicData: PublicDataRepository; raceId: string; sourceId: string; artifact: IngestedArtifact; chunks: ArtifactChunk[] }): string {
  const race = args.publicData.races.find((item) => item.id === args.raceId);
  const source = args.publicData.sources.find((item) => item.id === args.sourceId);
  const entities = args.publicData.entities.filter((entity) => race?.entityIds.includes(entity.id));
  const chunkText = args.chunks.map((chunk) => `CHUNK ${chunk.id}\n${chunk.text}`).join("\n\n---\n\n");
  return [
    `Prompt version: ${EXTRACTION_PROMPT_VERSION}`,
    "Extract draft election positions from clean voter-guide text.",
    "Return strict JSON matching this shape: {\"positions\":[{\"entityId\":string,\"kind\":\"endorse\"|\"oppose\"|\"rank\"|\"no-position\"|\"informational\",\"label\":string,\"rationale\":string,\"evidence\":[{\"chunkId\":string,\"quote\":string,\"kind\":\"quote\"|\"snippet\"|\"summary\"|\"link\"}]}]}",
    "Every evidence quote must be copied exactly from the referenced chunk. If unsure, return an empty positions array.",
    `Race: ${race?.id} / ${race?.title}`,
    `Source: ${source?.id} / ${source?.name}`,
    `Artifact: ${args.artifact.id} / ${args.artifact.url}`,
    `Allowed entities: ${entities.map((entity) => `${entity.id} (${entity.name})`).join(", ")}`,
    "Clean chunks (raw HTML omitted):",
    chunkText,
  ].join("\n\n");
}

async function loadPublicData(publicDir: string, checkedFiles: string[], issues: ExtractionValidationIssue[]): Promise<PublicDataRepository> {
  const [sources, entities, collections] = await Promise.all([
    readKeyedArray(path.join(publicDir, "sources.json"), "sources", checkedFiles, issues),
    readKeyedArray(path.join(publicDir, "entities.json"), "entities", checkedFiles, issues),
    readKeyedArray(path.join(publicDir, "collections.json"), "collections", checkedFiles, issues),
  ]);
  const racesDir = path.join(publicDir, "races");
  let raceFiles: string[] = [];
  try {
    raceFiles = (await fs.readdir(racesDir)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    addIssue(issues, "missing_public_races", "error", relative(racesDir), formatError(error));
  }
  const races = [];
  for (const file of raceFiles) {
    const json = await readJson<Record<string, unknown>>(path.join(racesDir, file), checkedFiles, issues, `public.races.${file}`);
    if (json && typeof json === "object" && "race" in json) races.push(json.race);
  }
  return { sources: sources as never[], entities: entities as never[], collections: collections as never[], races: races as never[] };
}

async function readKeyedArray(filePath: string, key: string, checkedFiles: string[], issues: ExtractionValidationIssue[]): Promise<unknown[]> {
  const json = await readJson<Record<string, unknown>>(filePath, checkedFiles, issues, key);
  if (!json || !Array.isArray(json[key])) {
    addIssue(issues, "invalid_shape", "error", relative(filePath), `Expected top-level '${key}' array.`);
    return [];
  }
  return json[key] as unknown[];
}

async function readJson<T>(filePath: string, checkedFiles: string[], issues: ExtractionValidationIssue[], issuePath: string): Promise<T | null> {
  checkedFiles.push(relative(filePath));
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    addIssue(issues, isSyntax(error) ? "malformed_json" : "missing_input_file", "error", issuePath, `${relative(filePath)}: ${formatError(error)}`);
    return null;
  }
}

function stripArtifactPrefix(artifactId: string): string {
  return artifactId.replace(/^art-/, "src-");
}

function addIssue(issues: ExtractionValidationIssue[], code: string, severity: ExtractionValidationIssue["severity"], issuePath: string, message: string, context: Partial<ExtractionValidationIssue> = {}): void {
  issues.push({ code, severity, path: issuePath, message: message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]"), sourceId: context.sourceId, artifactId: context.artifactId, chunkId: context.chunkId, raceId: context.raceId, entityId: context.entityId });
}

function isSyntax(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relative(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}
