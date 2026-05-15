import test from "node:test";
import assert from "node:assert/strict";
import { buildRaceDebugModel, generateStaticParams } from "../../app/debug/races/[slug]/page";

test("debug race route statically generates canonical real slugs", async () => {
  const params = await generateStaticParams();
  assert.ok(params.some((param) => param.slug === "california-governor"));
  assert.equal(params.some((param) => param.slug === "mayor"), false);
});

test("debug race model exposes loader counts without manual override marker", async () => {
  const model = await buildRaceDebugModel("california-governor");

  assert.ok(model);
  assert.equal(model.race.slug, "california-governor");
  assert.equal(model.race.title, "California Governor");
  assert.equal(model.counts.sources, 1);
  assert.equal(model.counts.entities, 61);
  assert.equal(model.counts.positions, 61);
  assert.equal(model.counts.evidence, 61);
  assert.equal(model.hasManualOverride, false);
  assert.ok(model.evidence.some((item) => item.url === "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf"));
  assert.equal(model.checkedFiles.some((file) => file.endsWith("manual/overrides/races/california-governor.json")), false);
  assert.equal(model.checkedFiles.some((file) => file.startsWith(".gsd/") || file.includes("/.gsd/")), false);
});

test("debug race model returns null for an unknown slug", async () => {
  assert.equal(await buildRaceDebugModel("missing-race"), null);
});
