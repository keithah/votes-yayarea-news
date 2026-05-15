#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const entityPathCandidates = ["out/entities/sample-candidate-a/index.html", "out/entities/sample-candidate-a.html"];
const sourcePathCandidates = ["out/sources/san-francisco-chronicle-editorial-board/index.html", "out/sources/san-francisco-chronicle-editorial-board.html"];
const racePathCandidates = ["out/races/mayor/index.html", "out/races/mayor.html"];

const entityPath = entityPathCandidates.find((path) => existsSync(path));
const sourcePath = sourcePathCandidates.find((path) => existsSync(path));
const racePath = racePathCandidates.find((path) => existsSync(path));

function fail(message) {
  console.error(`[assert-s08-export] ${message}`);
  process.exit(1);
}

function missingExportFailure(label, candidates) {
  fail(`Missing expected S08 ${label} static export output. Checked: ${candidates.join(", ")}. Run pnpm build before this assertion.`);
}

function assertIncludes(html, path, label, description) {
  if (!html.includes(label)) {
    fail(`Expected ${path} to include ${description}: ${JSON.stringify(label)}`);
  }
}

function assertMatches(html, path, pattern, description) {
  if (!pattern.test(html)) {
    fail(`Expected ${path} to match ${description}: ${pattern}`);
  }
}

function assertExcludes(html, path, label, description) {
  if (html.includes(label)) {
    fail(`Did not expect ${path} to include ${description}: ${JSON.stringify(label)}`);
  }
}

function assertAtLeast(html, path, pattern, minimum, description) {
  const count = html.match(pattern)?.length ?? 0;
  if (count < minimum) {
    fail(`Expected ${path} to include at least ${minimum} ${description}; found ${count}. Pattern: ${pattern}`);
  }
}

if (!entityPath) missingExportFailure("sample candidate entity", entityPathCandidates);
if (!sourcePath) missingExportFailure("San Francisco Chronicle source", sourcePathCandidates);
if (!racePath) missingExportFailure("mayor race", racePathCandidates);

const entityHtml = readFileSync(entityPath, "utf8");
const sourceHtml = readFileSync(sourcePath, "utf8");
const raceHtml = readFileSync(racePath, "utf8");
const combinedHtml = `${entityHtml}\n${sourceHtml}\n${raceHtml}`;

const requiredEntityText = [
  ["data-drilldown-kind=\"entity\"", "entity route diagnostic kind attribute"],
  ["data-drilldown-slug=\"sample-candidate-a\"", "entity route slug diagnostic attribute"],
  ["Sample Candidate A", "entity page heading"],
  ["Entity drill-down", "entity drill-down route label"],
  ["Published recommendation trail", "entity recommendation count panel"],
  ["What reached the static entity route", "entity diagnostics heading"],
  ["Related races", "entity related races section"],
  ["San Francisco Mayor", "entity related race link text"],
  ["href=\"/races/mayor/\"", "entity related race href"],
  ["Related sources", "entity related sources section"],
  ["San Francisco Chronicle Editorial Board", "entity related source link text"],
  ["href=\"/sources/san-francisco-chronicle-editorial-board/\"", "entity related source href"],
  ["Verified public recommendations", "entity receipts heading"],
  ["Draft extracted positive signal for Candidate A", "entity public recommendation label"],
  ["The sample text describes Candidate A with a positive policy emphasis.", "entity public recommendation rationale"],
  ["Candidate A is described in this sample as emphasizing faster housing approvals", "entity public evidence quote"],
  ["https://www.sfchronicle.com/projects/2026/sample-voter-guide/mayor", "entity public evidence/source URL"],
  ["data-footer-disclosure-link=\"how-we-use-ai\"", "footer disclosure link attribute on entity page"],
  ["href=\"/how-we-use-ai/\"", "static footer disclosure href on entity page"],
];

for (const [label, description] of requiredEntityText) {
  assertIncludes(entityHtml, entityPath, label, description);
}

const requiredSourceText = [
  ["data-drilldown-kind=\"source\"", "source route diagnostic kind attribute"],
  ["data-drilldown-slug=\"san-francisco-chronicle-editorial-board\"", "source route slug diagnostic attribute"],
  ["San Francisco Chronicle Editorial Board", "source page heading"],
  ["Source drill-down", "source drill-down route label"],
  ["Visit public source", "source external action label"],
  ["https://www.sfchronicle.com/projects/2026/sample-voter-guide", "source guide URL"],
  ["What reached the static source route", "source diagnostics heading"],
  ["Related races", "source related races section"],
  ["San Francisco Mayor", "source related race link text"],
  ["href=\"/races/mayor/\"", "source related race href"],
  ["Related entities", "source related entities section"],
  ["Sample Candidate A", "source related entity link text"],
  ["href=\"/entities/sample-candidate-a/\"", "source related entity href"],
  ["Verified public recommendations", "source receipts heading"],
  ["Draft extracted positive signal for Candidate A", "source public recommendation label"],
  ["Candidate A is described in this sample as emphasizing faster housing approvals", "source public evidence quote"],
  ["data-footer-disclosure-link=\"how-we-use-ai\"", "footer disclosure link attribute on source page"],
  ["href=\"/how-we-use-ai/\"", "static footer disclosure href on source page"],
];

for (const [label, description] of requiredSourceText) {
  assertIncludes(sourceHtml, sourcePath, label, description);
}

const requiredRaceText = [
  ["href=\"/entities/sample-candidate-a/\"", "race candidate card entity drill-down link"],
  ["href=\"/sources/san-francisco-chronicle-editorial-board/\"", "race source card source drill-down link"],
  ["Source page", "race source card internal source page action"],
  ["Visit source", "race source card external source action"],
  ["https://www.sfchronicle.com/projects/2026/sample-voter-guide", "race source card external source URL"],
  ["data-footer-disclosure-link=\"how-we-use-ai\"", "footer disclosure link attribute on race page"],
  ["href=\"/how-we-use-ai/\"", "static footer disclosure href on race page"],
];

for (const [label, description] of requiredRaceText) {
  assertIncludes(raceHtml, racePath, label, description);
}

const requiredEntityPatterns = [
  [/data-related-race-count="[1-9]\d*"/, "entity related race count diagnostic attribute"],
  [/data-recommendation-count="[1-9]\d*"/, "entity recommendation count diagnostic attribute"],
  [/data-evidence-count="[1-9]\d*"/, "entity evidence count diagnostic attribute"],
  [/data-checked-file-count="[1-9]\d*"/, "entity checked file count diagnostic attribute"],
  [/data-recommendation-id="pos-[^"]+"[^>]+data-recommendation-review-status="(?:reviewed|verified|published)"[^>]+data-recommendation-publication-status="public"/, "entity public recommendation status diagnostics"],
  [/data-drilldown-evidence-id="ev-[^"]+"[^>]+data-drilldown-evidence-position-id="pos-[^"]+"[^>]+data-drilldown-evidence-review-status="(?:reviewed|verified|published)"[^>]+data-drilldown-evidence-publication-status="public"/, "entity public evidence status diagnostics"],
  [/data-drilldown-evidence-source-url="https:\/\/[^"]+"/, "entity evidence source URL diagnostic attribute"],
];

for (const [pattern, description] of requiredEntityPatterns) {
  assertMatches(entityHtml, entityPath, pattern, description);
}

const requiredSourcePatterns = [
  [/data-related-race-count="[1-9]\d*"/, "source related race count diagnostic attribute"],
  [/data-recommendation-count="[1-9]\d*"/, "source recommendation count diagnostic attribute"],
  [/data-evidence-count="[1-9]\d*"/, "source evidence count diagnostic attribute"],
  [/data-checked-file-count="[1-9]\d*"/, "source checked file count diagnostic attribute"],
  [/data-recommendation-id="pos-[^"]+"[^>]+data-recommendation-review-status="(?:reviewed|verified|published)"[^>]+data-recommendation-publication-status="public"/, "source public recommendation status diagnostics"],
  [/data-drilldown-evidence-id="ev-[^"]+"[^>]+data-drilldown-evidence-position-id="pos-[^"]+"[^>]+data-drilldown-evidence-review-status="(?:reviewed|verified|published)"[^>]+data-drilldown-evidence-publication-status="public"/, "source public evidence status diagnostics"],
  [/data-drilldown-evidence-source-url="https:\/\/[^"]+"/, "source evidence source URL diagnostic attribute"],
];

for (const [pattern, description] of requiredSourcePatterns) {
  assertMatches(sourceHtml, sourcePath, pattern, description);
}

assertAtLeast(entityHtml, entityPath, /data-drilldown-evidence-id="ev-[^"]+"/g, 1, "entity public evidence items");
assertAtLeast(sourceHtml, sourcePath, /data-drilldown-evidence-id="ev-[^"]+"/g, 1, "source public evidence items");
assertAtLeast(raceHtml, racePath, /href="\/entities\/sample-candidate-a\/"/g, 1, "race-to-entity links");
assertAtLeast(raceHtml, racePath, /href="\/sources\/san-francisco-chronicle-editorial-board\/"/g, 1, "race-to-source links");

const forbiddenText = [
  ["Drill-down pages will link", "old drill-down placeholder copy"],
  ["Source and candidate drill-down placeholders", "old drill-down placeholder heading"],
  ["future drill-down", "stale drill-down placeholder wording"],
  ["before drill-down work ships", "old drill-down placeholder explanatory copy"],
  ["No public recommendations are available", "unexpected drill-down empty-state copy for sample pages"],
  ["publicationStatus\":\"hidden\"", "hidden publication status JSON leakage"],
  [".gsd/", "private GSD directory path leakage"],
  [".gsd", "private GSD directory leakage"],
];

for (const [label, description] of forbiddenText) {
  assertExcludes(combinedHtml, `${entityPath} + ${sourcePath} + ${racePath}`, label, description);
}

console.log(`S08 export assertions passed for ${entityPath}, ${sourcePath}, and ${racePath}.`);
