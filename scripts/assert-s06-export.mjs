#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const racePathCandidates = ["out/races/mayor/index.html", "out/races/mayor.html"];
const racePath = racePathCandidates.find((path) => existsSync(path));

function fail(message) {
  console.error(`[assert-s06-export] ${message}`);
  process.exit(1);
}

function assertIncludes(html, label, description) {
  if (!html.includes(label)) {
    fail(`Expected ${racePath} to include ${description}: ${JSON.stringify(label)}`);
  }
}

function assertMatches(html, pattern, description) {
  if (!pattern.test(html)) {
    fail(`Expected ${racePath} to match ${description}: ${pattern}`);
  }
}

function assertExcludes(html, label, description) {
  if (html.includes(label)) {
    fail(`Did not expect ${racePath} to include ${description}: ${JSON.stringify(label)}`);
  }
}

if (!racePath) {
  fail(`Missing expected S06 static export output. Checked: ${racePathCandidates.join(", ")}. Run pnpm build before this assertion.`);
}

const html = readFileSync(racePath, "utf8");

const requiredText = [
  ["Source-by-candidate comparison", "matrix heading"],
  ["Recommendation matrix presentation controls", "controls aria label"],
  ["Source type", "source type control label"],
  ["Candidate focus", "candidate focus control label"],
  ["Position focus", "position focus control label"],
  ["Sort rows", "sort control label"],
  ["Grouping", "grouping control label"],
  ["Public recommendation matrix grouped by", "desktop table caption"],
  ["Mobile recommendation cards", "mobile cards aria label"],
  ["civic voter guide / recommendations", "grouped civic voter guide source type"],
  ["editorial endorsements", "grouped editorial source type"],
  ["No public position", "neutral missing-cell copy"],
  ["0 evidence references", "mobile missing-cell evidence count text"],
  ["1 evidence", "desktop evidence count text"],
];

for (const [label, description] of requiredText) {
  assertIncludes(html, label, description);
}

const requiredPatterns = [
  [/data-matrix-view="desktop"/, "desktop matrix container"],
  [/data-matrix-view="mobile"/, "mobile matrix container"],
  [/class="recommendation-table"/, "desktop recommendation table"],
  [/data-source-type="civic voter guide \/ recommendations"/, "source-type grouped tbody for civic voter guide"],
  [/data-source-type="editorial endorsements"/, "source-type grouped tbody for editorial endorsements"],
  [/data-position-kind="informational"/, "informational matrix cell"],
  [/data-position-kind="no-public-position"/, "neutral matrix cell"],
  [/data-matrix-cell-id="cell:src-growsf::ent-sample-candidate-b"/, "stable Growsf candidate B cell id"],
  [/aria-label="[^\"]*No public position, 0 evidence references"/, "accessible missing-cell label"],
];

for (const [pattern, description] of requiredPatterns) {
  assertMatches(html, pattern, description);
}

const forbiddenText = [
  ["Static candidate-by-source matrix placeholder", "old S05 matrix placeholder copy"],
  ["before matrix work ships", "old S05 matrix placeholder explanatory copy"],
  ["unfinished matrix", "placeholder-only matrix copy"],
  ["title=\"Comparison matrix\"", "old placeholder component prop"],
];

for (const [label, description] of forbiddenText) {
  assertExcludes(html, label, description);
}

console.log(`S06 export assertions passed for ${racePath}.`);
