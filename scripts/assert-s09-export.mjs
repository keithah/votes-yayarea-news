#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const ROUTES = [
  {
    label: "homepage",
    route: "/",
    candidates: ["out/index.html"],
    requiredText: [
      ["A public trail for 2026 California and San Francisco election records.", "homepage hero heading"],
      ["Browse public races", "homepage public race action"],
      ["votes.yayarea.news · San Francisco election guide", "homepage share title"],
    ],
    metadata: {
      canonical: "https://votes.yayarea.news/",
      title: "votes.yayarea.news · San Francisco election guide",
      description: "Static San Francisco election source tracker with 13 public races, 13 reviewed sources, and 61 evidence items.",
    },
  },
  {
    label: "California Governor race",
    route: "/races/california-governor/",
    candidates: ["out/races/california-governor/index.html", "out/races/california-governor.html"],
    requiredText: [
      ["data-analytics-event=\"race_page_view\"", "race page-view analytics marker"],
      ["data-analytics-route-kind=\"race\"", "race route-kind analytics payload marker"],
      ["data-analytics-race-slug=\"california-governor\"", "race slug analytics payload marker"],
      ["data-analytics-event=\"recommendation_matrix_open\"", "matrix interaction analytics marker"],
      ["data-analytics-event=\"receipt_drawer_open\"", "receipt drawer analytics marker"],
      ["Source-by-candidate comparison", "recommendation matrix heading"],
      ["Disclosure-ready summary module", "reviewed summary module"],
      ["data-footer-disclosure-link=\"how-we-use-ai\"", "footer AI disclosure link marker"],
      ["href=\"/entities/california-governor-akinyemi-agbede/\"", "race-to-entity link"],
      ["href=\"/sources/california-secretary-of-state/\"", "race-to-source link"],
    ],
    metadata: {
      canonical: "https://votes.yayarea.news/races/california-governor/",
      title: "California Governor source records",
      description: "Public source tracker for California Governor: 1 sources, 61 entities, and 61 evidence items.",
    },
  },
  {
    label: "AI disclosure",
    route: "/how-we-use-ai/",
    candidates: ["out/how-we-use-ai/index.html", "out/how-we-use-ai.html"],
    requiredText: [
      ["data-disclosure-route=\"how-we-use-ai\"", "AI disclosure route diagnostic marker"],
      ["What AI helps with", "AI assistance disclosure section"],
      ["What humans review", "human review disclosure section"],
      ["Public status controls what appears", "publication gate disclosure section"],
    ],
    metadata: {
      canonical: "https://votes.yayarea.news/how-we-use-ai/",
      title: "How we use AI",
      description: "How votes.yayarea.news uses AI assistance, human review, evidence, and publication gates for public election source records.",
    },
  },
  {
    label: "representative Governor entity",
    route: "/entities/california-governor-akinyemi-agbede/",
    candidates: ["out/entities/california-governor-akinyemi-agbede/index.html", "out/entities/california-governor-akinyemi-agbede.html"],
    requiredText: [
      ["data-drilldown-kind=\"entity\"", "entity route diagnostic kind"],
      ["data-drilldown-slug=\"california-governor-akinyemi-agbede\"", "entity route diagnostic slug"],
      ["Akinyemi Agbede", "entity heading"],
      ["Verified public recommendations", "entity public recommendations"],
      ["Democratic candidate listed by the California Secretary of State for California Governor", "entity public evidence quote"],
    ],
    metadata: {
      canonical: "https://votes.yayarea.news/entities/california-governor-akinyemi-agbede/",
      title: "Akinyemi Agbede public source trail",
      description: "Akinyemi Agbede public source trail across 1 races: 1 tracked source records and 1 evidence items.",
    },
  },
  {
    label: "representative source",
    route: "/sources/california-secretary-of-state/",
    candidates: ["out/sources/california-secretary-of-state/index.html", "out/sources/california-secretary-of-state.html"],
    requiredText: [
      ["data-drilldown-kind=\"source\"", "source route diagnostic kind"],
      ["data-drilldown-slug=\"california-secretary-of-state\"", "source route diagnostic slug"],
      ["California Secretary of State", "source heading"],
      ["Visit public source", "source public URL action"],
      ["Verified public recommendations", "source public recommendations"],
    ],
    metadata: {
      canonical: "https://votes.yayarea.news/sources/california-secretary-of-state/",
      title: "California Secretary of State public source trail",
      description: "California Secretary of State public source trail across 1 races: 61 tracked source records and 61 evidence items.",
    },
  },
];

const REQUIRED_META_IMAGE = "https://votes.yayarea.news/share/votes-yayarea-news.svg";
const REQUIRED_ANALYTICS_EVENTS = ["race_page_view", "recommendation_matrix_open", "receipt_drawer_open"];
const FORBIDDEN_PATTERNS = [
  [/\.gsd(?:\/|\b)/i, "private GSD directory leakage"],
  [/manual\/reviews\//i, "manual review staging leakage"],
  [/data\/extracted\/drafts\//i, "hidden extraction draft leakage"],
  [/\/home\/[^\s"'<>]+/i, "machine-local absolute path leakage"],
  [/file:\/\//i, "file URL leakage"],
  [/\b(?:vote\s+for|must\s+support|we\s+recommend|our\s+pick|best\s+choice)\b/i, "unsafe endorsement-language copy"],
  [/Static candidate-by-source matrix placeholder/i, "stale matrix placeholder copy"],
  [/Receipt drawer placeholder/i, "stale receipt placeholder copy"],
  [/AI disclosure placeholder/i, "stale AI placeholder copy"],
  [/before .*work ships/i, "old pre-launch explanatory copy"],
  [/Coming next/i, "old coming-next launch copy"],
];

function fail(message) {
  console.error(`[assert-s09-export] ${message}`);
  process.exit(1);
}

function resolveExportPath(route) {
  const path = route.candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    fail(`Phase export-files: missing ${route.label} export for ${route.route}. Checked: ${route.candidates.join(", ")}. Run pnpm build before S09 assertions.`);
  }
  return path;
}

function assertIncludes(html, path, label, description) {
  if (!html.includes(label)) {
    fail(`Phase route-html: expected ${path} (${description}) to include ${JSON.stringify(label)}.`);
  }
}

function assertMatches(html, path, pattern, description) {
  if (!pattern.test(html)) {
    fail(`Phase share-metadata: expected ${path} (${description}) to match ${pattern}.`);
  }
}

function assertExcludes(html, path, pattern, description) {
  if (pattern.test(html)) {
    fail(`Phase public-trust-leaks: ${path} contains ${description}. Pattern: ${pattern}.`);
  }
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metaPattern(attribute, name, content) {
  const anyAttrs = "[^>]*";
  return new RegExp(`<meta${anyAttrs}${attribute}=[\"']${escaped(name)}[\"']${anyAttrs}content=[\"']${escaped(content)}[\"']${anyAttrs}>|<meta${anyAttrs}content=[\"']${escaped(content)}[\"']${anyAttrs}${attribute}=[\"']${escaped(name)}[\"']${anyAttrs}>`, "i");
}

const loadedRoutes = ROUTES.map((route) => {
  const path = resolveExportPath(route);
  const html = readFileSync(path, "utf8");
  return { ...route, path, html };
});

for (const route of loadedRoutes) {
  for (const [label, description] of route.requiredText) {
    assertIncludes(route.html, route.path, label, description);
  }

  assertMatches(route.html, route.path, new RegExp(`<title>${escaped(route.metadata.title)}</title>`, "i"), "document title");
  assertMatches(route.html, route.path, metaPattern("name", "description", route.metadata.description), "description meta tag");
  assertMatches(route.html, route.path, new RegExp(`<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']${escaped(route.metadata.canonical)}[\"']`, "i"), "canonical link");
  assertMatches(route.html, route.path, metaPattern("property", "og:title", route.metadata.title), "Open Graph title");
  assertMatches(route.html, route.path, metaPattern("property", "og:description", route.metadata.description), "Open Graph description");
  assertMatches(route.html, route.path, metaPattern("property", "og:url", route.metadata.canonical), "Open Graph canonical URL");
  assertMatches(route.html, route.path, metaPattern("property", "og:image", REQUIRED_META_IMAGE), "Open Graph share image");
  assertMatches(route.html, route.path, metaPattern("name", "twitter:card", "summary_large_image"), "Twitter card type");
  assertMatches(route.html, route.path, metaPattern("name", "twitter:image", REQUIRED_META_IMAGE), "Twitter share image");

  for (const [pattern, description] of FORBIDDEN_PATTERNS) {
    assertExcludes(route.html, route.path, pattern, description);
  }
}

const combinedHtml = loadedRoutes.map((route) => route.html).join("\n");
for (const eventName of REQUIRED_ANALYTICS_EVENTS) {
  const count = (combinedHtml.match(new RegExp(`data-analytics-event=[\"']${eventName}[\"']`, "g")) ?? []).length;
  if (count < 1) {
    fail(`Phase analytics-coverage: missing required analytics marker ${eventName}.`);
  }
}

console.log(`S09 export assertions passed for ${loadedRoutes.map((route) => `${route.route} (${route.path})`).join(", ")}.`);
