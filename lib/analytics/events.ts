export const ANALYTICS_EVENTS = {
  racePageView: "race_page_view",
  recommendationMatrixOpen: "recommendation_matrix_open",
  aiSummaryExpand: "ai_summary_expand",
  receiptDrawerOpen: "receipt_drawer_open",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type AnalyticsRouteKind = "home" | "race" | "entity" | "source" | "disclosure" | "unknown";

export interface AnalyticsPayload {
  routeKind?: AnalyticsRouteKind;
  raceSlug?: string;
  sourceType?: string;
  sourceSlug?: string;
  candidateSlug?: string;
  entitySlug?: string;
  receiptAvailable?: boolean;
}

export interface NormalizedAnalyticsEvent {
  name: AnalyticsEventName;
  payload: AnalyticsPayload;
}

export interface AnalyticsProviderAdapter {
  track: (event: NormalizedAnalyticsEvent) => void | Promise<void>;
}

const EVENT_NAMES = new Set<string>(Object.values(ANALYTICS_EVENTS));
const ROUTE_KINDS = new Set<AnalyticsRouteKind>(["home", "race", "entity", "source", "disclosure", "unknown"]);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SOURCE_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_VALUE_LENGTH = 80;

type RawPayload = Record<string, unknown> | AnalyticsPayload | undefined;

export function normalizeAnalyticsEvent(name: string, payload: RawPayload = {}): NormalizedAnalyticsEvent | null {
  if (!isAnalyticsEventName(name)) return null;

  const normalizedPayload: AnalyticsPayload = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { name, payload: normalizedPayload };
  }

  const routeKind = normalizeRouteKind(payload.routeKind);
  if (routeKind) normalizedPayload.routeKind = routeKind;

  const raceSlug = normalizeSlug(payload.raceSlug);
  if (raceSlug) normalizedPayload.raceSlug = raceSlug;

  const sourceType = normalizeSourceType(payload.sourceType);
  if (sourceType) normalizedPayload.sourceType = sourceType;

  const sourceSlug = normalizeSlug(payload.sourceSlug);
  if (sourceSlug) normalizedPayload.sourceSlug = sourceSlug;

  const candidateSlug = normalizeSlug(payload.candidateSlug);
  if (candidateSlug) normalizedPayload.candidateSlug = candidateSlug;

  const entitySlug = normalizeSlug(payload.entitySlug);
  if (entitySlug) normalizedPayload.entitySlug = entitySlug;

  if (typeof payload.receiptAvailable === "boolean") {
    normalizedPayload.receiptAvailable = payload.receiptAvailable;
  }

  return { name, payload: normalizedPayload };
}

export function trackAnalyticsEvent(name: string, payload: RawPayload = {}, adapter?: AnalyticsProviderAdapter): void {
  if (isAnalyticsDisabled()) return;

  const event = normalizeAnalyticsEvent(name, payload);
  if (!event) return;

  try {
    void (adapter ?? createPlausibleAnalyticsAdapter()).track(event);
  } catch {
    // Analytics must fail closed: blocked scripts, malformed globals, and provider
    // exceptions should never change public static UI behavior.
  }
}

export function trackRacePageView(payload: Pick<AnalyticsPayload, "routeKind" | "raceSlug"> = {}): void {
  trackAnalyticsEvent(ANALYTICS_EVENTS.racePageView, payload);
}

export function createPlausibleAnalyticsAdapter(win: PlausibleWindow | undefined = getBrowserWindow()): AnalyticsProviderAdapter {
  return {
    track(event) {
      if (!win) return;
      const plausible = win.plausible;
      if (typeof plausible === "function") {
        try {
          plausible(event.name, { props: event.payload });
        } catch {
          // Provider script failures are non-fatal.
        }
        return;
      }

      // Static-compatible fallback for Plausible-compatible endpoints loaded without
      // the helper script. The endpoint is public configuration, not a secret.
      const endpoint = normalizeEndpoint(win.__VOTES_ANALYTICS_ENDPOINT__);
      if (!endpoint) return;

      const body = JSON.stringify({ name: event.name, props: event.payload });
      if (typeof win.navigator?.sendBeacon === "function") {
        try {
          const sent = win.navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
          if (sent) return;
        } catch {
          // Fall back to fetch below.
        }
      }

      if (typeof win.fetch === "function") {
        void win.fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => undefined);
      }
    },
  };
}

export const plausibleAnalyticsAdapter = createPlausibleAnalyticsAdapter();

export function inferRouteAnalytics(pathname: string): Pick<AnalyticsPayload, "routeKind" | "raceSlug"> {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { routeKind: "home" };
  if (parts[0] === "races") {
    const raceSlug = normalizeSlug(parts[1]);
    return raceSlug ? { routeKind: "race", raceSlug } : { routeKind: "race" };
  }
  if (parts[0] === "entities") return { routeKind: "entity" };
  if (parts[0] === "sources") return { routeKind: "source" };
  if (pathname === "/how-we-use-ai") return { routeKind: "disclosure" };
  return { routeKind: "unknown" };
}

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return EVENT_NAMES.has(name);
}

function isAnalyticsDisabled(): boolean {
  const win = getBrowserWindow();
  if (win?.__VOTES_ANALYTICS_DISABLED__ === true) return true;
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ANALYTICS_DISABLED === "true") return true;
  return false;
}

function normalizeRouteKind(value: unknown): AnalyticsRouteKind | undefined {
  return typeof value === "string" && ROUTE_KINDS.has(value as AnalyticsRouteKind) ? (value as AnalyticsRouteKind) : undefined;
}

function normalizeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > MAX_VALUE_LENGTH) return undefined;
  if (!SLUG_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function normalizeSourceType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (normalized.length === 0 || normalized.length > MAX_VALUE_LENGTH) return undefined;
  if (!SOURCE_TYPE_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function normalizeEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!/^https:\/\/[^\s"'<>]+$/i.test(value)) return undefined;
  return value;
}

function getBrowserWindow(): PlausibleWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return window as PlausibleWindow;
}

export interface PlausibleWindow extends Window {
  plausible?: (eventName: string, options?: { props?: AnalyticsPayload }) => void;
  __VOTES_ANALYTICS_DISABLED__?: boolean;
  __VOTES_ANALYTICS_ENDPOINT__?: string;
}
