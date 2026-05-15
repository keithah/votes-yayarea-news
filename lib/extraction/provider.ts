import type { DraftEvidence, DraftPosition, ExtractionProviderMetadata, ExtractionValidationIssue } from "./types";

export interface ProviderRequest {
  prompt: string;
  metadata: ExtractionProviderMetadata;
  signal?: AbortSignal;
}

export interface ProviderPosition {
  entityId: string;
  kind: DraftPosition["kind"];
  label: string;
  rationale?: string;
  evidence: Array<Pick<DraftEvidence, "chunkId" | "quote" | "kind">>;
}

export interface ProviderResponse {
  positions: ProviderPosition[];
  requestId?: string;
}

export interface ExtractionProvider {
  name: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export class ExtractionProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly issue: ExtractionValidationIssue;

  constructor(code: string, message: string, options: { status?: number; path?: string } = {}) {
    super(sanitize(message));
    this.name = "ExtractionProviderError";
    this.code = code;
    this.status = options.status;
    this.issue = { code, severity: "error", path: options.path ?? "provider", message: sanitize(message) };
  }
}

export function createProvider(name: string, options: { model: string; apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number } | { fixtureResponse: ProviderResponse }): ExtractionProvider {
  if (name === "fixture") return createFixtureProvider("fixtureResponse" in options ? options.fixtureResponse : undefined);
  if (name === "openai") {
    if (!("model" in options)) throw new ExtractionProviderError("missing_model", "OpenAI provider requires a model.");
    return createOpenAiProvider(options);
  }
  throw new ExtractionProviderError("unknown_provider", `Unsupported extraction provider '${name}'.`);
}

export function createFixtureProvider(response?: ProviderResponse): ExtractionProvider {
  return {
    name: "fixture",
    async complete(request) {
      if (response) return response;
      return inferFixtureResponse(request.prompt);
    },
  };
}

export function createOpenAiProvider(options: { model: string; apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): ExtractionProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    name: "openai",
    async complete(request) {
      if (!apiKey) throw new ExtractionProviderError("missing_credentials", "OPENAI_API_KEY is required for provider 'openai'.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
      const signal = request.signal ?? controller.signal;
      try {
        const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: options.model, temperature: request.metadata.temperature ?? 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: "You extract election position drafts as strict JSON only." }, { role: "user", content: request.prompt }] }),
          signal,
        });
        const requestId = response.headers.get("x-request-id") ?? undefined;
        if (!response.ok) throw new ExtractionProviderError(`provider_http_${response.status}`, `Provider returned HTTP ${response.status}.`, { status: response.status });
        const payload = (await response.json()) as unknown;
        const content = extractChatContent(payload);
        return { ...parseProviderJson(content), requestId };
      } catch (error) {
        if (error instanceof ExtractionProviderError) throw error;
        if (isAbort(error)) throw new ExtractionProviderError("provider_timeout", "Provider request timed out or was aborted.");
        throw new ExtractionProviderError("provider_error", error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function parseProviderJson(content: string): ProviderResponse {
  let json: unknown;
  try {
    json = JSON.parse(content) as unknown;
  } catch (error) {
    throw new ExtractionProviderError("invalid_provider_json", error instanceof Error ? error.message : String(error), { path: "provider.response" });
  }
  if (!isRecord(json) || !Array.isArray(json.positions)) throw new ExtractionProviderError("invalid_provider_shape", "Provider JSON must include a positions array.", { path: "provider.response.positions" });
  return { positions: json.positions as ProviderPosition[] };
}

function extractChatContent(payload: unknown): string {
  if (!isRecord(payload)) throw new ExtractionProviderError("invalid_provider_shape", "Provider response was not an object.");
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0 && isRecord(choices[0]) && isRecord(choices[0].message) && typeof choices[0].message.content === "string") return choices[0].message.content;
  throw new ExtractionProviderError("invalid_provider_shape", "Provider response did not include message content.");
}

function inferFixtureResponse(prompt: string): ProviderResponse {
  const positions: ProviderPosition[] = [];
  if (prompt.includes("ent-sample-candidate-a") && prompt.includes("Candidate A is described in this sample as emphasizing faster housing approvals")) {
    positions.push({ entityId: "ent-sample-candidate-a", kind: "endorse", label: "Draft extracted positive signal for Candidate A", rationale: "The sample text describes Candidate A with a positive policy emphasis.", evidence: [{ chunkId: firstChunkId(prompt), kind: "quote", quote: "Candidate A is described in this sample as emphasizing faster housing approvals and clear performance goals for city departments." }] });
  }
  if (prompt.includes("ent-sample-candidate-b") && prompt.includes("Candidate B receives a placeholder mixed description")) {
    positions.push({ entityId: "ent-sample-candidate-b", kind: "informational", label: "Draft extracted mixed signal for Candidate B", rationale: "The sample text describes Candidate B with a mixed placeholder description.", evidence: [{ chunkId: firstChunkId(prompt), kind: "quote", quote: "In this sample, Candidate B receives a placeholder mixed description for fiscal oversight and a slower approach to housing production." }] });
  }
  return { positions };
}

function firstChunkId(prompt: string): string {
  return /^CHUNK\s+(\S+)/m.exec(prompt)?.[1] ?? "missing-chunk";
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitize(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]");
}
