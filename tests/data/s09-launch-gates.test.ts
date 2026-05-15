import test from "node:test";
import assert from "node:assert/strict";

const shareImage = "<meta property=\"og:image\" content=\"https://votes.yayarea.news/share/votes-yayarea-news.svg\"><meta name=\"twitter:image\" content=\"https://votes.yayarea.news/share/votes-yayarea-news.svg\">";

async function loadLaunchGateModule(): Promise<{
  createLaunchGateReport: (input: { now: Date; htmlByRoute: Record<string, string>; smokeReport: unknown }) => unknown;
  assertLaunchGateReport: (report: unknown) => string[];
}> {
  return await import(new URL("../../scripts/record-s09-launch-gates.mjs", import.meta.url).href) as {
    createLaunchGateReport: (input: { now: Date; htmlByRoute: Record<string, string>; smokeReport: unknown }) => unknown;
    assertLaunchGateReport: (report: unknown) => string[];
  };
}

function html({ title, canonical, body = "votes.yayarea.news San Francisco" }: { title: string; canonical: string; body?: string }): string {
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${canonical}">${shareImage}</head><body>${body}</body></html>`;
}

test("S09 launch gate report records blocking pass gates and keeps manual notes explicit pending", async () => {
  const { createLaunchGateReport, assertLaunchGateReport } = await loadLaunchGateModule();
  const report = createLaunchGateReport({
    now: new Date("2026-01-02T03:04:05.000Z"),
    htmlByRoute: {
      "/": html({ title: "votes.yayarea.news · San Francisco election guide", canonical: "https://votes.yayarea.news/" }),
      "/races/mayor/": html({
        title: "San Francisco Mayor source records",
        canonical: "https://votes.yayarea.news/races/mayor/",
        body: 'votes.yayarea.news San Francisco <div data-analytics-event="race_page_view"></div><button data-analytics-event="recommendation_matrix_open"></button><button data-analytics-event="ai_summary_expand"></button><button data-analytics-event="receipt_drawer_open"></button>',
      }),
      "/how-we-use-ai/": html({ title: "How we use AI", canonical: "https://votes.yayarea.news/how-we-use-ai/" }),
      "/entities/sample-candidate-a/": html({ title: "Sample Candidate A public source trail", canonical: "https://votes.yayarea.news/entities/sample-candidate-a/" }),
      "/sources/san-francisco-chronicle-editorial-board/": html({ title: "San Francisco Chronicle Editorial Board public source trail", canonical: "https://votes.yayarea.news/sources/san-francisco-chronicle-editorial-board/" }),
    },
    smokeReport: {
      ok: true,
      checkedRoutes: [{ route: "/", status: 200, contentType: "text/html; charset=utf-8" }],
      trailingSlashChecks: [{ route: "/races/mayor", status: 308, location: "/races/mayor/" }],
    },
  }) as { overallStatus: string; buildTimestamp: string; gates: Record<string, { status: string }> };

  assert.equal(report.overallStatus, "pass");
  assert.equal(report.buildTimestamp, "2026-01-02T03:04:05.000Z");
  assert.equal(report.gates.metadataShareStatus.status, "pass");
  assert.equal(report.gates.analyticsEventCoverage.status, "pass");
  assert.equal(report.gates.publicTrustLeakChecks.status, "pass");
  assert.equal(report.gates.staticSmoke.status, "pass");
  assert.equal(report.gates.manualLighthouseBrowserNotes.status, "pending");
  assert.deepEqual(assertLaunchGateReport(report), []);
});

test("S09 launch gate report fails closed on public trust leaks", async () => {
  const { createLaunchGateReport } = await loadLaunchGateModule();
  const report = createLaunchGateReport({
    now: new Date("2026-01-02T03:04:05.000Z"),
    htmlByRoute: {
      "/": html({ title: "votes.yayarea.news · San Francisco election guide", canonical: "https://votes.yayarea.news/", body: "See .gsd/milestones/M001" }),
    },
    smokeReport: { ok: true, checkedRoutes: [], trailingSlashChecks: [] },
  }) as { overallStatus: string; gates: { publicTrustLeakChecks: { status: string } } };

  assert.equal(report.overallStatus, "fail");
  assert.equal(report.gates.publicTrustLeakChecks.status, "fail");
});
