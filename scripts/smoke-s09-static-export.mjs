#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const OUT_DIR = resolve("out");
const ROUTES = ["/", "/races/mayor/", "/how-we-use-ai/", "/entities/sample-candidate-a/", "/sources/san-francisco-chronicle-editorial-board/"];
const CONTENT_TYPE_BY_EXT = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function phaseFail(phase, message, diagnostics = {}) {
  const error = new Error(`[smoke-s09-static-export] Phase ${phase}: ${message}`);
  error.phase = phase;
  error.diagnostics = diagnostics;
  return error;
}

function choosePort() {
  const raw = process.env.S09_SMOKE_PORT;
  if (!raw) return 0;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw phaseFail("server-start", `invalid S09_SMOKE_PORT ${JSON.stringify(raw)}; expected 1024-65535.`);
  }
  return port;
}

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?", 1)[0]);
  const normalizedPath = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(join(OUT_DIR, normalizedPath));
  if (candidate !== OUT_DIR && !candidate.startsWith(`${OUT_DIR}${sep}`)) return null;
  return candidate;
}

function findStaticFile(urlPath) {
  const candidate = safeFilePath(urlPath);
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

function createStaticServer() {
  return createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname;

      if (pathname !== "/" && !pathname.endsWith("/") && !extname(pathname)) {
        const slashPath = `${pathname}/`;
        if (findStaticFile(slashPath)) {
          response.writeHead(308, { location: slashPath });
          response.end();
          return;
        }
      }

      const filePath = findStaticFile(pathname);
      if (!filePath) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(200, { "content-type": CONTENT_TYPE_BY_EXT.get(extname(filePath)) ?? "application/octet-stream" });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Unknown server error");
    }
  });
}

async function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", (error) => rejectListen(phaseFail("server-start", error.message)));
    server.listen(port, "127.0.0.1", () => resolveListen(server.address()));
  });
}

async function close(server) {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options });
  const text = await response.text();
  return { response, text };
}

async function runSmoke() {
  if (!existsSync(OUT_DIR) || !statSync(OUT_DIR).isDirectory()) {
    throw phaseFail("preflight", "missing out/ directory. Run pnpm build before S09 static smoke.");
  }

  const server = createStaticServer();
  const startedAt = new Date().toISOString();
  const address = await listen(server, choosePort());
  const port = typeof address === "object" && address ? address.port : undefined;
  if (!port) throw phaseFail("server-start", "server started without a usable local port.");

  const diagnostics = {
    phase: "static-smoke",
    ok: false,
    startedAt,
    origin: `http://127.0.0.1:${port}`,
    checkedRoutes: [],
    trailingSlashChecks: [],
  };

  try {
    for (const route of ROUTES) {
      const { response, text } = await fetchText(`${diagnostics.origin}${route}`);
      const contentType = response.headers.get("content-type") ?? "";
      const check = { route, status: response.status, contentType, bytes: text.length };
      diagnostics.checkedRoutes.push(check);
      if (response.status !== 200) throw phaseFail("route-fetch", `${route} returned ${response.status}.`, diagnostics);
      if (!contentType.toLowerCase().startsWith("text/html")) throw phaseFail("content-type", `${route} returned ${contentType}; expected text/html.`, diagnostics);
      if (!text.includes("votes.yayarea.news") && !text.includes("San Francisco")) throw phaseFail("route-content", `${route} did not include expected public site content.`, diagnostics);
    }

    for (const route of ROUTES.filter((value) => value !== "/")) {
      const noSlash = route.slice(0, -1);
      const { response } = await fetchText(`${diagnostics.origin}${noSlash}`);
      const location = response.headers.get("location") ?? "";
      const check = { route: noSlash, status: response.status, location };
      diagnostics.trailingSlashChecks.push(check);
      if (response.status !== 308 || location !== route) {
        throw phaseFail("trailing-slash", `${noSlash} returned ${response.status} with Location ${JSON.stringify(location)}; expected 308 to ${route}.`, diagnostics);
      }
    }

    diagnostics.ok = true;
    diagnostics.completedAt = new Date().toISOString();
    console.log(JSON.stringify(diagnostics, null, 2));
  } finally {
    await close(server);
  }
}

runSmoke().catch((error) => {
  const payload = {
    phase: error?.phase ?? "unknown",
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    diagnostics: error?.diagnostics ?? undefined,
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
