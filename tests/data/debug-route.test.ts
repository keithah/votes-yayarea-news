import test from "node:test";
import assert from "node:assert/strict";
import { buildRaceDebugModel, generateStaticParams } from "../../app/debug/races/[slug]/page";

test("debug race route statically generates the sample mayor slug", async () => {
  assert.deepEqual(await generateStaticParams(), [{ slug: "mayor" }]);
});

test("debug race model exposes loader counts and manual override marker", async () => {
  const model = await buildRaceDebugModel("mayor");

  assert.ok(model);
  assert.equal(model.race.slug, "mayor");
  assert.equal(model.race.title, "San Francisco Mayor");
  assert.equal(model.counts.sources, 2);
  assert.equal(model.counts.entities, 2);
  assert.equal(model.counts.positions, 4);
  assert.equal(model.counts.evidence, 4);
  assert.equal(model.hasManualOverride, true);
  assert.ok(model.evidence.some((item) => item.url === "https://www.sfchronicle.com/projects/2026/sample-voter-guide/mayor"));
  assert.ok(model.checkedFiles.some((file) => file.endsWith("manual/overrides/races/mayor.json")));
  assert.equal(model.checkedFiles.some((file) => file.startsWith(".gsd/") || file.includes("/.gsd/")), false);
});

test("debug race model returns null for an unknown slug", async () => {
  assert.equal(await buildRaceDebugModel("missing-race"), null);
});
