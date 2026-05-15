#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const racePathCandidates = ["out/races/mayor/index.html", "out/races/mayor.html"];
const disclosurePathCandidates = ["out/how-we-use-ai/index.html", "out/how-we-use-ai.html"];

const racePath = racePathCandidates.find((path) => existsSync(path));
const disclosurePath = disclosurePathCandidates.find((path) => existsSync(path));

function fail(message) {
  console.error(`[assert-s07-export] ${message}`);
  process.exit(1);
}

function missingExportFailure(label, candidates) {
  fail(`Missing expected S07 ${label} static export output. Checked: ${candidates.join(", ")}. Run pnpm build before this assertion.`);
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

if (!racePath) missingExportFailure("mayor race", racePathCandidates);
if (!disclosurePath) missingExportFailure("AI disclosure", disclosurePathCandidates);

const raceHtml = readFileSync(racePath, "utf8");
const disclosureHtml = readFileSync(disclosurePath, "utf8");
const combinedHtml = `${raceHtml}\n${disclosureHtml}`;

const requiredRaceText = [
  ["Source-by-candidate comparison", "recommendation matrix heading"],
  ["evidence receipts", "race lede receipt readiness copy"],
  ["data-receipt-status=\"available\"", "available receipt status attributes"],
  ["data-receipt-evidence-count=\"1\"", "receipt evidence count attributes"],
  ["Open evidence receipt", "receipt-opening matrix button aria label"],
  ["Disclosure-ready summary module", "reviewed summary module heading"],
  ["Read reviewed summary and public evidence", "reviewed summary expansion control"],
  ["Summary supporting evidence", "reviewed summary supporting evidence list label"],
  ["data-summary-evidence-count=\"2\"", "reviewed summary evidence count attribute"],
  ["data-summary-evidence-id=", "reviewed summary evidence id attributes"],
  ["Open supporting source", "reviewed summary source links"],
  ["Sample summary after local manual review override", "public reviewed summary copy"],
  ["https://www.sfchronicle.com/projects/2026/sample-voter-guide", "public source URL"],
  ["data-footer-disclosure-link=\"how-we-use-ai\"", "footer disclosure link attribute on race page"],
  ["href=\"/how-we-use-ai/\"", "static footer disclosure href on race page"],
];

for (const [label, description] of requiredRaceText) {
  assertIncludes(raceHtml, racePath, label, description);
}

const requiredRacePatterns = [
  [/data-race-slug="mayor"/, "race slug diagnostic attribute"],
  [/data-receipt-count="\d+"/, "receipt count diagnostic attribute"],
  [/data-receipt-available-count="[1-9]\d*"/, "available receipt count diagnostic attribute"],
  [/data-selected-cell-id="none"/, "default selected receipt cell id diagnostic attribute"],
  [/data-matrix-cell-id="cell:[^"]+"[^>]+data-receipt-status="available"/, "receipt-ready matrix cell"],
  [/data-matrix-cell-id="cell:[^"]+"[^>]+data-receipt-status="unavailable"/, "unavailable receipt matrix cell"],
  [/data-receipt-empty-reason="no-public-position"/, "explicit unavailable receipt empty reason"],
  [/data-summary-status="available"/, "available reviewed summary status"],
  [/data-summary-id="[^"]+"/, "reviewed summary id attribute"],
  [/data-summary-evidence-id="[^"]+"[^>]+data-summary-source-id="[^"]+"[^>]+data-summary-review-status="[^"]+"[^>]+data-summary-publication-status="[^"]+"/, "summary evidence source/status diagnostics"],
  [/“[^”]+”/, "public quote text"],
  [/href="https:\/\/[^"]+"/, "public source href"],
];

for (const [pattern, description] of requiredRacePatterns) {
  assertMatches(raceHtml, racePath, pattern, description);
}

assertAtLeast(raceHtml, racePath, /data-receipt-status="available"/g, 1, "available receipt cells");
assertAtLeast(raceHtml, racePath, /data-summary-evidence-id="[^"]+"/g, 1, "reviewed summary evidence items");

const requiredDisclosureText = [
  ["data-disclosure-route=\"how-we-use-ai\"", "disclosure route diagnostic attribute"],
  ["How we use AI", "disclosure page title"],
  ["What AI helps with", "AI assistance disclosure section"],
  ["What humans review", "human review disclosure section"],
  ["What is never automated", "AI boundary disclosure section"],
  ["Evidence requirements", "evidence requirements disclosure section"],
  ["Public status controls what appears", "publication gate disclosure section"],
  ["Questions and corrections", "corrections disclosure section"],
  ["data-footer-disclosure-link=\"how-we-use-ai\"", "footer disclosure link attribute on disclosure page"],
  ["href=\"/how-we-use-ai/\"", "static footer disclosure href on disclosure page"],
];

for (const [label, description] of requiredDisclosureText) {
  assertIncludes(disclosureHtml, disclosurePath, label, description);
}

const forbiddenText = [
  ["Static receipt drawer placeholder", "old S05 receipt placeholder copy"],
  ["Receipt drawer placeholder", "old generic receipt placeholder copy"],
  ["explicit placeholders for receipts, AI disclosure", "old race lede placeholder copy"],
  ["AI disclosure placeholder", "old S05 AI placeholder copy"],
  ["Reviewed AI summary placeholder", "old reviewed summary placeholder copy"],
  ["No reviewed public AI-assisted summary is published", "reviewed summary empty-state copy on mayor export"],
  ["A reviewed public summary exists, but its supporting evidence is not available", "withheld reviewed summary copy on mayor export"],
  ["before receipt work ships", "old receipt placeholder explanatory copy"],
  ["before AI disclosure work ships", "old AI placeholder explanatory copy"],
  [".gsd/", "private GSD directory path leakage"],
  [".gsd", "private GSD directory leakage"],
];

for (const [label, description] of forbiddenText) {
  assertExcludes(combinedHtml, `${racePath} + ${disclosurePath}`, label, description);
}

console.log(`S07 export assertions passed for ${racePath} and ${disclosurePath}.`);
