#!/usr/bin/env node
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path, { extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_OUT_DIR, loadRouteContracts, normalizeRoute } from "./assert-s05-launch-export.mjs";

export const DEFAULT_SMOKE_REPORT_PATH = "data/launch/s05-static-smoke.json";
export const SMOKE_GENERATOR = "scripts/smoke-s05-static-export.mjs";
export const DEFAULT_ROUTE_SAMPLE_LIMIT = 12;
export const DEFAULT_ASSET_SAMPLE_LIMIT = 30;

const CONTENT_TYPE_BY_EXT = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const EXPECTED_ASSET_TYPES = new Map([
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const ASSET_EXTENSIONS = new Set(EXPECTED_ASSET_TYPES.keys());

export class SmokeFailure extends Error {
  constructor(phase, message, diagnostics = {}) {
    super(`[smoke-s05-static-export] Phase ${phase}: ${message}`);
    this.name = "SmokeFailure";
    this.phase = phase;
    this.diagnostics = diagnostics;
  }
}

export function phaseFail(phase, message, diagnostics = {}) {
  return new SmokeFailure(phase, message, diagnostics);
}

export function choosePort(env = process.env) {
  const raw = env.S05_SMOKE_PORT;
  if (!raw) return 0;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw phaseFail("server-start", `invalid S05_SMOKE_PORT ${JSON.stringify(raw)}; expected integer 1024-65535.`, { envVar: "S05_SMOKE_PORT", value: raw });
  }
  return port;
}

export function safeFilePath(urlPath, outDir = resolve(DEFAULT_OUT_DIR)) {
  const decodedPath = String(urlPath).split("?", 1)[0];
  if (decodedPath.split(/[\\/]+/).includes("..")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(decodedPath);
  } catch {
    return null;
  }
  if (decoded.replaceAll("\\", "/").split("/").includes("..")) return null;
  const normalizedPath = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(join(outDir, normalizedPath));
  if (candidate !== outDir && !candidate.startsWith(`${outDir}${sep}`)) return null;
  return candidate;
}

export function findStaticFile(urlPath, outDir = resolve(DEFAULT_OUT_DIR)) {
  const candidate = safeFilePath(urlPath, outDir);
  if (!candidate) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const index = join(candidate, "index.html");
    if (existsSync(index) && statSync(index).isFile()) return index;
  }
  const html = `${candidate}.html`;
  if (existsSync(html) && statSync(html).isFile()) return html;
  return null;
}

export function createStaticServer({ outDir = resolve(DEFAULT_OUT_DIR) } = {}) {
  return createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname;

      if (!safeFilePath(pathname, outDir)) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("Bad request");
        return;
      }

      if (pathname !== "/" && !pathname.endsWith("/") && !extname(pathname)) {
        const slashPath = `${pathname}/`;
        if (findStaticFile(slashPath, outDir)) {
          response.writeHead(308, { location: slashPath });
          response.end();
          return;
        }
      }

      const filePath = findStaticFile(pathname, outDir);
      if (!filePath) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(200, { "content-type": CONTENT_TYPE_BY_EXT.get(extname(filePath).toLowerCase()) ?? "application/octet-stream" });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Unknown server error");
    }
  });
}

async function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", (error) => rejectListen(phaseFail("server-start", error.message, { port })));
    server.listen(port, "127.0.0.1", () => resolveListen(server.address()));
  });
}

async function close(server) {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function fetchBody(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options });
  const arrayBuffer = await response.arrayBuffer();
  const bytes = arrayBuffer.byteLength;
  const text = new TextDecoder().decode(arrayBuffer);
  return { response, text, bytes };
}

export function parseCliArgs(argv = process.argv.slice(2), projectRoot = process.cwd()) {
  const options = { jsonOut: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json-out") {
      const value = argv[index + 1];
      if (!value) throw phaseFail("json-out", "--json-out requires a path value.");
      options.jsonOut = validateJsonOutPath(value, projectRoot);
      index += 1;
      continue;
    }
    throw phaseFail("cli", `unknown argument ${JSON.stringify(arg)}.`);
  }
  return options;
}

export function validateJsonOutPath(relativePath, projectRoot = process.cwd()) {
  if (!relativePath || path.isAbsolute(relativePath)) throw phaseFail("json-out", `json-out path must be a project-relative path under data/launch: ${JSON.stringify(relativePath)}.`);
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized.startsWith("data/launch/") || !normalized.endsWith(".json")) {
    throw phaseFail("json-out", `json-out path must be a .json file under data/launch/: ${JSON.stringify(relativePath)}.`);
  }
  const fullPath = resolve(projectRoot, relativePath);
  const launchDir = resolve(projectRoot, "data/launch");
  if (fullPath !== launchDir && !fullPath.startsWith(`${launchDir}${sep}`)) {
    throw phaseFail("json-out", `json-out path escapes data/launch/: ${JSON.stringify(relativePath)}.`);
  }
  return fullPath;
}

export function selectRepresentativeRoutes(routes, limit = DEFAULT_ROUTE_SAMPLE_LIMIT) {
  const selected = [];
  const seen = new Set();
  const add = (contract) => {
    if (!contract?.route) return;
    const route = normalizeRoute(contract.route);
    if (seen.has(route)) return;
    seen.add(route);
    selected.push({ ...contract, route });
  };

  for (const className of ["homepage", "race", "source", "entity", "disclosure"]) add(routes.find((route) => route.className === className));
  for (const route of routes) {
    if (selected.length >= limit) break;
    add(route);
  }
  return selected.slice(0, limit);
}

export function extractLocalAssetHrefs(html, sourceRoute = "/", origin = "http://127.0.0.1") {
  const values = [];
  const patterns = [
    /<(?:script)\b[^>]*\bsrc=(['"])(.*?)\1/gi,
    /<(?:link)\b[^>]*\bhref=(['"])(.*?)\1/gi,
    /<(?:img|source)\b[^>]*\bsrc=(['"])(.*?)\1/gi,
    /<(?:img|source)\b[^>]*\bsrcset=(['"])(.*?)\1/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) values.push(...expandSrcset(match[2]));
  }

  const assets = [];
  for (const value of values) {
    if (!value || value.startsWith("#") || /^(?:data|mailto|tel|javascript):/i.test(value)) continue;
    let url;
    try {
      url = new URL(value, `${origin}${normalizeRoute(sourceRoute)}`);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    const assetPath = url.pathname;
    if (!ASSET_EXTENSIONS.has(extname(assetPath).toLowerCase())) continue;
    assets.push(assetPath);
  }
  return [...new Set(assets)].sort();
}

function expandSrcset(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
}

export function selectAssetSample(routeHtmlChecks, limit = DEFAULT_ASSET_SAMPLE_LIMIT) {
  const assets = [];
  const seen = new Set();
  for (const routeCheck of routeHtmlChecks) {
    for (const asset of routeCheck.assets ?? []) {
      if (seen.has(asset)) continue;
      seen.add(asset);
      assets.push(asset);
      if (assets.length >= limit) return assets;
    }
  }
  return assets;
}

export function validateS05StaticSmokeReport(report) {
  const errors = [];
  if (!report || typeof report !== "object") return ["report must be an object"];
  if (report.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (report.slice !== "S05") errors.push("slice must be S05");
  if (report.generatedBy !== SMOKE_GENERATOR) errors.push("generatedBy must identify the S05 smoke script");
  if (report.status !== "pass") errors.push("status must be pass");
  for (const field of ["startedAt", "completedAt"]) {
    if (!report[field] || Number.isNaN(Date.parse(report[field]))) errors.push(`${field} must be an ISO timestamp`);
  }
  if (!report.origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(report.origin)) errors.push("origin must be a 127.0.0.1 HTTP origin");
  if (!report.counts || typeof report.counts !== "object") errors.push("counts object is required");
  for (const key of ["checkedRoutes", "redirectChecks", "assetChecks"]) {
    if (!Number.isInteger(report.counts?.[key]) || report.counts[key] < 0) errors.push(`counts.${key} must be a non-negative integer`);
  }
  if (!Array.isArray(report.checkedRoutes) || report.checkedRoutes.length === 0) errors.push("checkedRoutes must be a non-empty array");
  if (!Array.isArray(report.redirectChecks)) errors.push("redirectChecks must be an array");
  if (!Array.isArray(report.assetChecks)) errors.push("assetChecks must be an array");
  for (const route of report.checkedRoutes ?? []) {
    if (!route.route || route.status !== 200 || !String(route.contentType ?? "").toLowerCase().startsWith("text/html") || !Number.isInteger(route.bytes) || route.bytes <= 0) {
      errors.push(`checked route ${route.route ?? "<missing>"} must have 200 text/html and positive bytes`);
    }
  }
  for (const redirect of report.redirectChecks ?? []) {
    if (!redirect.route || redirect.status !== 308 || redirect.location !== redirect.expectedLocation) errors.push(`redirect ${redirect.route ?? "<missing>"} must be 308 to expectedLocation`);
  }
  for (const asset of report.assetChecks ?? []) {
    if (!asset.asset || asset.status === 404 || asset.status < 200 || asset.status >= 400 || !Number.isInteger(asset.bytes) || asset.bytes <= 0) errors.push(`asset ${asset.asset ?? "<missing>"} must return non-404 success with positive bytes`);
  }
  for (const finding of findPrivatePathLeakage(report)) errors.push(`report leaked ${finding.description}: ${finding.match}`);
  return errors;
}

function findPrivatePathLeakage(value) {
  const patterns = [
    { description: "private GSD path", pattern: /\.gsd\//i },
    { description: "absolute local path", pattern: /\/home\//i },
    { description: "file URL path", pattern: /file:\/\//i },
    { description: "private manual review path", pattern: /manual\/(?:reviews|overrides)\//i },
  ];
  const findings = [];
  const visit = (item) => {
    if (typeof item === "string") {
      for (const check of patterns) {
        const match = check.pattern.exec(item);
        if (match) findings.push({ description: check.description, match: match[0] });
      }
      return;
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) item.forEach(visit);
    else Object.values(item).forEach(visit);
  };
  visit(value);
  return findings;
}

export async function runS05StaticSmoke({ projectRoot = process.cwd(), outDir = resolve(projectRoot, DEFAULT_OUT_DIR), jsonOut = null, port = choosePort() } = {}) {
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
    throw phaseFail("preflight", "missing out/ directory. Run pnpm build before S05 static smoke.", { outDir: path.relative(projectRoot, outDir) || DEFAULT_OUT_DIR });
  }

  const contracts = loadRouteContracts(projectRoot);
  if (contracts.issues.length > 0) throw phaseFail("route-discovery", contracts.issues.join("; "));
  const routes = selectRepresentativeRoutes(contracts.routes);
  const server = createStaticServer({ outDir });
  const startedAt = new Date().toISOString();
  const address = await listen(server, port);
  const actualPort = typeof address === "object" && address ? address.port : undefined;
  if (!actualPort) throw phaseFail("server-start", "server started without a usable local port.");

  const report = {
    schemaVersion: 1,
    slice: "S05",
    generatedBy: SMOKE_GENERATOR,
    status: "fail",
    startedAt,
    origin: `http://127.0.0.1:${actualPort}`,
    checkedRoutes: [],
    redirectChecks: [],
    assetChecks: [],
    counts: { checkedRoutes: 0, redirectChecks: 0, assetChecks: 0 },
    phases: {
      preflight: { status: "pass" },
      routeDiscovery: { status: "pass", classCounts: contracts.classCounts, sampledRoutes: routes.length },
      serverStart: { status: "pass" },
      routeFetch: { status: "pending" },
      redirectChecks: { status: "pending" },
      assetChecks: { status: "pending" },
      jsonOut: { status: jsonOut ? "pending" : "skipped" },
    },
  };

  try {
    for (const contract of routes) {
      const { response, text, bytes } = await fetchBody(`${report.origin}${contract.route}`);
      const contentType = response.headers.get("content-type") ?? "";
      const assets = extractLocalAssetHrefs(text, contract.route, report.origin);
      const check = { route: contract.route, className: contract.className, status: response.status, contentType, bytes, assets };
      report.checkedRoutes.push(check);
      if (response.status !== 200) throw phaseFail("route-fetch", `${contract.route} returned ${response.status}.`, report);
      if (!contentType.toLowerCase().startsWith("text/html")) throw phaseFail("content-type", `${contract.route} returned ${contentType}; expected text/html.`, report);
      if (!/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) throw phaseFail("content-type", `${contract.route} returned text/html headers but the body was not an HTML document.`, report);
      if (bytes <= 0) throw phaseFail("route-fetch", `${contract.route} returned an empty HTML response.`, report);
    }
    report.phases.routeFetch = { status: "pass", checked: report.checkedRoutes.length };

    for (const contract of routes.filter((route) => route.route !== "/")) {
      const noSlash = contract.route.slice(0, -1);
      const { response } = await fetchBody(`${report.origin}${noSlash}`);
      const location = response.headers.get("location") ?? "";
      const check = { route: noSlash, status: response.status, location, expectedLocation: contract.route };
      report.redirectChecks.push(check);
      if (response.status !== 308 || location !== contract.route) {
        throw phaseFail("redirect-check", `${noSlash} returned ${response.status} with Location ${JSON.stringify(location)}; expected 308 to ${contract.route}.`, report);
      }
    }
    report.phases.redirectChecks = { status: "pass", checked: report.redirectChecks.length };

    for (const asset of selectAssetSample(report.checkedRoutes)) {
      const { response, bytes } = await fetchBody(`${report.origin}${asset}`);
      const contentType = response.headers.get("content-type") ?? "";
      const expectedType = EXPECTED_ASSET_TYPES.get(extname(asset).toLowerCase()) ?? "application/octet-stream";
      const check = { asset, status: response.status, contentType, expectedType, bytes };
      report.assetChecks.push(check);
      if (response.status === 404 || response.status < 200 || response.status >= 400) throw phaseFail("asset-fetch", `${asset} returned ${response.status}.`, report);
      if (!contentType.toLowerCase().startsWith(expectedType)) throw phaseFail("asset-content-type", `${asset} returned ${contentType}; expected ${expectedType}.`, report);
      if (bytes <= 0) throw phaseFail("asset-fetch", `${asset} returned an empty asset response.`, report);
    }
    report.phases.assetChecks = { status: "pass", checked: report.assetChecks.length, sampleLimit: DEFAULT_ASSET_SAMPLE_LIMIT };

    report.status = "pass";
    report.completedAt = new Date().toISOString();
    report.counts = {
      checkedRoutes: report.checkedRoutes.length,
      redirectChecks: report.redirectChecks.length,
      assetChecks: report.assetChecks.length,
    };

    const validationErrors = validateS05StaticSmokeReport(report);
    if (validationErrors.length > 0) throw phaseFail("smoke-report", validationErrors.join("; "), report);

    if (jsonOut) {
      mkdirSync(path.dirname(jsonOut), { recursive: true });
      writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
      report.phases.jsonOut = { status: "pass", path: path.relative(projectRoot, jsonOut).replaceAll(path.sep, "/") };
      writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
    }

    return report;
  } finally {
    await close(server);
  }
}

async function main() {
  try {
    const { jsonOut } = parseCliArgs();
    const report = await runS05StaticSmoke({ jsonOut });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const payload = {
      phase: error?.phase ?? "unknown",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      diagnostics: error?.diagnostics ?? undefined,
    };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
