import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYTICS_EVENTS,
  createPlausibleAnalyticsAdapter,
  inferRouteAnalytics,
  normalizeAnalyticsEvent,
  trackAnalyticsEvent,
  type AnalyticsProviderAdapter,
  type PlausibleWindow,
} from "../../lib/analytics/events";

test("keeps required analytics event names stable", () => {
  assert.deepEqual(ANALYTICS_EVENTS, {
    racePageView: "race_page_view",
    recommendationMatrixOpen: "recommendation_matrix_open",
    aiSummaryExpand: "ai_summary_expand",
    receiptDrawerOpen: "receipt_drawer_open",
  });
});

test("normalizes payloads to public dimensions only", () => {
  const event = normalizeAnalyticsEvent(ANALYTICS_EVENTS.receiptDrawerOpen, {
    routeKind: "race",
    raceSlug: "Sf-Mayor-2026",
    sourceType: "Editorial Endorsements",
    sourceSlug: "Chronicle",
    candidateSlug: "Alice-Example",
    entitySlug: "ignored-because-not-needed",
    receiptAvailable: true,
    quote: "private raw quote should not leave the page",
    localPath: "/home/keith/src/yayarea.news/votes/manual/overrides/races/mayor.json",
    artifactId: "artifact-private-id",
  });

  assert.deepEqual(event, {
    name: "receipt_drawer_open",
    payload: {
      routeKind: "race",
      raceSlug: "sf-mayor-2026",
      sourceType: "editorial-endorsements",
      sourceSlug: "chronicle",
      candidateSlug: "alice-example",
      entitySlug: "ignored-because-not-needed",
      receiptAvailable: true,
    },
  });
  assert.equal(Object.hasOwn(event?.payload ?? {}, "quote"), false);
  assert.equal(Object.hasOwn(event?.payload ?? {}, "localPath"), false);
  assert.equal(Object.hasOwn(event?.payload ?? {}, "artifactId"), false);
});

test("drops malformed, oversized, quoted, private-path, and empty slug values", () => {
  const event = normalizeAnalyticsEvent(ANALYTICS_EVENTS.aiSummaryExpand, {
    routeKind: "admin",
    raceSlug: "",
    sourceSlug: "/home/keith/secret-source",
    candidateSlug: "alice\"example",
    entitySlug: "x".repeat(120),
    sourceType: "Voter Guides / 2026 \"quoted\"",
    receiptAvailable: false,
  });

  assert.deepEqual(event, {
    name: "ai_summary_expand",
    payload: {
      sourceType: "voter-guides-2026-quoted",
      receiptAvailable: false,
    },
  });

  for (const value of Object.values(event?.payload ?? {})) {
    if (typeof value === "string") {
      assert.doesNotMatch(value, /["'“”]/);
      assert.doesNotMatch(value, /\/[A-Za-z]|\\/);
      assert.ok(value.length <= 80);
    }
  }
});

test("unsupported event names and disabled mode are no-ops", () => {
  const previous = process.env.NEXT_PUBLIC_ANALYTICS_DISABLED;
  const calls: unknown[] = [];
  const adapter: AnalyticsProviderAdapter = { track: (event) => { calls.push(event); } };

  trackAnalyticsEvent("unsupported_event", { raceSlug: "sf-mayor" }, adapter);
  assert.equal(calls.length, 0);

  process.env.NEXT_PUBLIC_ANALYTICS_DISABLED = "true";
  trackAnalyticsEvent(ANALYTICS_EVENTS.racePageView, { routeKind: "race", raceSlug: "sf-mayor" }, adapter);
  assert.equal(calls.length, 0);

  if (previous === undefined) delete process.env.NEXT_PUBLIC_ANALYTICS_DISABLED;
  else process.env.NEXT_PUBLIC_ANALYTICS_DISABLED = previous;
});

test("provider exceptions and rejected network paths fail closed", () => {
  assert.doesNotThrow(() => {
    trackAnalyticsEvent(ANALYTICS_EVENTS.racePageView, { routeKind: "race", raceSlug: "sf-mayor" }, {
      track() {
        throw new Error("provider blocked");
      },
    });
  });

  const adapter = createPlausibleAnalyticsAdapter({
    plausible() {
      throw new Error("script failed");
    },
  } as unknown as PlausibleWindow);
  assert.doesNotThrow(() => adapter.track({ name: ANALYTICS_EVENTS.aiSummaryExpand, payload: { raceSlug: "sf-mayor" } }));
});

test("plausible adapter emits sanitized props without cookies or secrets", () => {
  const calls: Array<{ eventName: string; options?: unknown }> = [];
  const adapter = createPlausibleAnalyticsAdapter({
    plausible(eventName: string, options?: { props?: unknown }) {
      calls.push({ eventName, options });
    },
  } as unknown as PlausibleWindow);

  trackAnalyticsEvent(ANALYTICS_EVENTS.recommendationMatrixOpen, { routeKind: "race", raceSlug: "sf-mayor", sourceType: "Voter Guides" }, adapter);

  assert.deepEqual(calls, [
    {
      eventName: "recommendation_matrix_open",
      options: { props: { routeKind: "race", raceSlug: "sf-mayor", sourceType: "voter-guides" } },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /cookie|secret|\/home\/keith|manual\/overrides|quote/i);
});

test("route inference exposes route kind and race slug without leaking raw paths", () => {
  assert.deepEqual(inferRouteAnalytics("/"), { routeKind: "home" });
  assert.deepEqual(inferRouteAnalytics("/races/sf-mayor-2026/"), { routeKind: "race", raceSlug: "sf-mayor-2026" });
  assert.deepEqual(inferRouteAnalytics("/races//../../manual/overrides/races/mayor.json"), { routeKind: "race" });
  assert.deepEqual(inferRouteAnalytics("/how-we-use-ai"), { routeKind: "disclosure" });
});
