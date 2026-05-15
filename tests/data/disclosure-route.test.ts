import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { metadata } from "../../app/how-we-use-ai/page";

const REQUIRED_DISCLOSURE_SECTIONS = [
  "what-ai-does",
  "human-review",
  "never-automated",
  "evidence-requirements",
  "public-status-gating",
  "limitations",
  "corrections",
];

test("AI disclosure route exports static metadata and required disclosure sections", async () => {
  const routePath = path.join(process.cwd(), "app", "how-we-use-ai", "page.tsx");
  const routeSource = await fs.readFile(routePath, "utf8");

  assert.equal(routeSource.includes('export const dynamic = "force-static"'), true);
  assert.equal(metadata.title, "How we use AI");
  assert.match(String(metadata.description), /AI assistance/);
  assert.equal(routeSource.includes('data-disclosure-route="how-we-use-ai"'), true);

  for (const section of REQUIRED_DISCLOSURE_SECTIONS) {
    assert.equal(routeSource.includes(`id: "${section}"`), true, `missing disclosure section ${section}`);
    assert.equal(routeSource.includes("data-disclosure-section"), true);
  }

  assert.equal(routeSource.includes("AI does not decide how anyone should vote"), true);
  assert.equal(routeSource.includes("Draft, rejected, hidden"), true);
});

test("global layout footer exposes a stable how-we-use-ai link", async () => {
  const layoutSource = await fs.readFile(path.join(process.cwd(), "app", "layout.tsx"), "utf8");

  assert.equal(layoutSource.includes('href="/how-we-use-ai"'), true);
  assert.equal(layoutSource.includes('data-footer-disclosure-link="how-we-use-ai"'), true);
  assert.equal(layoutSource.includes('aria-label="Footer navigation"'), true);
});
