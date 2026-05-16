import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ORIGIN,
  REPRESENTATIVE_ROUTE_CONTRACTS,
  assertRouteHtml,
  buildRouteUrl,
  normalizeOrigin,
  parseCliArgs,
  runLivePageAssertions,
  validateJsonOutPath,
  validateLiveReport,
} from "../../scripts/assert-m004-s05-live-pages.mjs";

const HTML_BY_ROUTE: Record<string, string> = Object.fromEntries(
  REPRESENTATIVE_ROUTE_CONTRACTS.map((contract: any) => [contract.route, htmlForContract(contract)]),
);

test("normalizes origins with or without trailing slash and repository base path", () => {
  assert.equal(buildRouteUrl(normalizeOrigin("https://keithah.github.io"), "/races/california-governor/"), "https://keithah.github.io/races/california-governor/");
  assert.equal(buildRouteUrl(normalizeOrigin("https://keithah.github.io/votes-yayarea-news/"), "/races/california-governor/"), "https://keithah.github.io/votes-yayarea-news/races/california-governor/");
  assert.equal(buildRouteUrl(normalizeOrigin(DEFAULT_ORIGIN), "races/california-governor/"), "https://keithah.github.io/votes-yayarea-news/races/california-governor/");
});

test("rejects malformed origins before network work", async () => {
  let called = false;
  await assert.rejects(
    runLivePageAssertions({ origin: "file:///tmp/site", fetchImpl: async () => {
      called = true;
      return htmlResponse("never");
    } }),
    (error: any) => error.phase === "origin",
  );
  assert.equal(called, false);
});

test("json-out validation rejects absolute, escaping, and non-launch paths", () => {
  const projectRoot = process.cwd();
  assert.throws(() => validateJsonOutPath("/tmp/report.json", projectRoot), (error: any) => error.phase === "json-out");
  assert.throws(() => validateJsonOutPath("data/launch/../report.json", projectRoot), (error: any) => error.phase === "json-out");
  assert.throws(() => validateJsonOutPath("data/private/report.json", projectRoot), (error: any) => error.phase === "json-out");
  assert.throws(() => validateJsonOutPath("data/launch/report.txt", projectRoot), (error: any) => error.phase === "json-out");
});

test("parseCliArgs wires origin, timeout, and validated json-out path", () => {
  const options = parseCliArgs(["--origin", "https://example.test/base/", "--timeout-ms", "2500", "--json-out", "data/launch/live.json"], process.cwd());
  assert.equal(options.origin, "https://example.test/base/");
  assert.equal(options.timeoutMs, 2500);
  assert.equal(options.jsonOut, "data/launch/live.json");
});

test("successful live assertion writes a redaction-safe validated report", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "m004-s05-live-"));
  const reportPath = "data/launch/live-report.json";
  const report = await runLivePageAssertions({
    origin: "https://example.test/votes-yayarea-news/",
    projectRoot,
    jsonOut: reportPath,
    fetchImpl: fetchFromRoutes(HTML_BY_ROUTE),
  });

  assert.equal(report.status, "pass");
  assert.equal(report.origin, "https://example.test/votes-yayarea-news");
  assert.deepEqual(validateLiveReport(report), []);
  assert.equal(report.checkedRoutes.length, 3);
  assert.ok(report.counts.markerAssertions > 20);
  assert.equal(report.counts.leakageFindings, 0);

  const persisted = JSON.parse(await readFile(path.join(projectRoot, reportPath), "utf8"));
  assert.deepEqual(validateLiveReport(persisted), []);
  const serialized = JSON.stringify(persisted);
  assert.doesNotMatch(serialized, /manual\/(?:reviews|overrides)\//i);
  assert.doesNotMatch(serialized, /\.gsd\//i);
  assert.doesNotMatch(serialized, /\/home\//i);
  assert.doesNotMatch(serialized, /<html/i);
});

test("non-200 responses fail with route diagnostics and phase non-200", async () => {
  await assert.rejects(
    runLivePageAssertions({
      origin: "https://example.test/votes-yayarea-news",
      fetchImpl: fetchFromRoutes({ ...HTML_BY_ROUTE, "/races/california-governor/": { status: 404, body: "Not found" } }),
    }),
    (error: any) => {
      assert.equal(error.phase, "non-200");
      assert.equal(error.diagnostics.checkedRoutes.at(-1).route, "/races/california-governor/");
      assert.equal(error.diagnostics.checkedRoutes.at(-1).status, 404);
      return true;
    },
  );
});

test("missing expanded comparison markers fail closed with marker names", async () => {
  const staleStateAssembly = HTML_BY_ROUTE["/races/state-assembly-district-17/"].replace('data-source-id="src-growsf"', "");
  await assert.rejects(
    runLivePageAssertions({
      origin: "https://example.test/votes-yayarea-news",
      fetchImpl: fetchFromRoutes({ ...HTML_BY_ROUTE, "/races/state-assembly-district-17/": staleStateAssembly }),
    }),
    (error: any) => {
      assert.equal(error.phase, "marker");
      assert.match(error.message, /GrowSF source/);
      assert.equal(error.diagnostics.checkedRoutes[0].missingMarkers.includes("GrowSF source"), true);
      return true;
    },
  );
});

test("private-path leakage fails with pattern id and route only", async () => {
  const leaked = `${HTML_BY_ROUTE["/races/us-house-district-11/"]}<p>manual/reviews/private.json</p>`;
  await assert.rejects(
    runLivePageAssertions({
      origin: "https://example.test/votes-yayarea-news",
      fetchImpl: fetchFromRoutes({ ...HTML_BY_ROUTE, "/races/us-house-district-11/": leaked }),
    }),
    (error: any) => {
      assert.equal(error.phase, "leakage");
      const route = error.diagnostics.checkedRoutes.at(-1);
      assert.equal(route.route, "/races/us-house-district-11/");
      assert.deepEqual(route.leakageFindings, [{ patternId: "manual-review-path", description: "private manual review path" }]);
      assert.doesNotMatch(JSON.stringify(error.diagnostics), /manual\/reviews\/private/);
      return true;
    },
  );
});

test("fetch errors and timeouts use phase diagnostics", async () => {
  await assert.rejects(
    runLivePageAssertions({ origin: "https://example.test", fetchImpl: async () => { throw new Error("DNS failed"); } }),
    (error: any) => error.phase === "fetch" && /DNS failed/.test(error.message),
  );

  await assert.rejects(
    runLivePageAssertions({ origin: "https://example.test", timeoutMs: 100, fetchImpl: async (_url: string, options: any) => {
      await new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        (error as any).name = "AbortError";
        reject(error);
      }));
      return htmlResponse("never");
    } }),
    (error: any) => error.phase === "timeout",
  );
});

test("assertRouteHtml exposes missing marker and leakage details without full HTML", () => {
  const result = assertRouteHtml(REPRESENTATIVE_ROUTE_CONTRACTS[1], '<html data-race-slug="california-governor">manual/overrides/private.json</html>');
  assert.ok(result.missingMarkers.includes("Chronicle source"));
  assert.deepEqual(result.leakageFindings, [{ patternId: "manual-review-path", description: "private manual review path" }]);
});

function fetchFromRoutes(routes: Record<string, string | { status: number; body: string }>) {
  return async (url: string) => {
    const pathname = new URL(url).pathname;
    const route = pathname.replace(/^\/votes-yayarea-news/, "");
    const value = routes[route];
    if (!value) return htmlResponse("Not found", 404);
    if (typeof value === "string") return htmlResponse(value, 200);
    return htmlResponse(value.body, value.status);
  };
}

function htmlResponse(body: string, status = 200) {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function htmlForContract(contract: any) {
  if (contract.slug === "state-assembly-district-17") {
    return baseHtml(`
      <main data-race-slug="state-assembly-district-17">
        <h1>State Assembly District 17</h1>
        <h2>Source-by-candidate comparison</h2>
        <section data-matrix-source-count="2" data-matrix-cell-count="4">
          <div data-matrix-view="desktop"></div><div data-matrix-view="mobile"></div>
          <p>California Secretary of State</p><p>GrowSF</p>
          <span data-source-id="src-ca-secretary-of-state"></span><span data-source-id="src-growsf"></span>
          <span data-candidate-id="ent-state-assembly-district-17-matt-haney"></span>
          <span data-position-kind="informational" data-receipt-status="available"></span>
          <span data-position-kind="endorse" data-receipt-status="available"></span>
        </section>
      </main>`);
  }
  if (contract.slug === "california-governor") {
    return baseHtml(`
      <main data-race-slug="california-governor">
        <h1>California Governor</h1>
        <h2>Source-by-candidate comparison</h2>
        <section data-matrix-source-count="3" data-matrix-cell-count="9">
          <div data-matrix-view="desktop"></div><div data-matrix-view="mobile"></div>
          <p>California Secretary of State</p><p>San Francisco Chronicle</p><p>GrowSF</p>
          <span data-source-id="src-ca-secretary-of-state"></span><span data-source-id="src-sf-chronicle"></span><span data-source-id="src-growsf"></span>
          <span data-candidate-id="ent-california-governor-katie-porter"></span>
          <span data-candidate-id="ent-california-governor-matt-mahan"></span>
          <span data-position-kind="endorse" data-receipt-status="available"></span>
          <span data-position-kind="no-public-position" data-receipt-empty-reason="no-public-position"></span>
        </section>
      </main>`);
  }
  return baseHtml(`
    <main data-race-slug="us-house-district-11">
      <h1>U.S. House District 11</h1>
      <h2>Source-by-candidate comparison</h2>
      <section data-matrix-source-count="2" data-matrix-cell-count="4">
        <div data-matrix-view="desktop"></div><div data-matrix-view="mobile"></div>
        <p>GrowSF</p><p>Scott Wiener has 2 evidence receipts.</p>
        <span data-source-id="src-growsf"></span>
        <span data-candidate-id="ent-us-house-district-11-scott-wiener"></span>
        <span data-position-kind="endorse" data-receipt-status="available"></span>
      </section>
    </main>`);
}

function baseHtml(body: string) {
  return `<!doctype html><html><body>${body}</body></html>`;
}
