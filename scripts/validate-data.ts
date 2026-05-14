import { listRaceSlugs, loadRaceData } from "../lib/data/loaders";
import { loadPublicData, validatePublicData, validatePublicDataFiles } from "../lib/data/validate";
import type { Race } from "../lib/data/types";

async function main(): Promise<void> {
  const canonicalResult = await validatePublicDataFiles();
  const overridden = await validateOverriddenData();

  console.log("Checked files:");
  for (const file of [...new Set([...canonicalResult.checkedFiles, ...overridden.checkedFiles])].sort()) {
    console.log(`- ${file}`);
  }

  printCounts("Canonical counts", canonicalResult.counts);
  printCounts("Overridden counts", overridden.result.counts);

  const issues = [...canonicalResult.issues, ...overridden.result.issues];
  if (!canonicalResult.ok || !overridden.result.ok) {
    console.error("Validation failures:");
    for (const issue of issues) {
      console.error(`- ${issue.path}: [${issue.code}] ${issue.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Validation passed.");
  }
}

async function validateOverriddenData(): Promise<{ result: ReturnType<typeof validatePublicData>; checkedFiles: string[] }> {
  const loaded = await loadPublicData();
  const slugs = await listRaceSlugs();
  const mergedRaces: Race[] = [];
  const checkedFiles = [...loaded.checkedFiles];

  for (const slug of slugs) {
    const loadedRace = await loadRaceData(slug);
    if (!loadedRace) continue;
    mergedRaces.push(loadedRace.race);
    checkedFiles.push(...loadedRace.checkedFiles);
  }

  const result = validatePublicData({ ...loaded.repository, races: mergedRaces }, [...new Set(checkedFiles)]);
  return { result, checkedFiles: result.checkedFiles };
}

function printCounts(label: string, counts: { sources: number; entities: number; collections: number; races: number; positions: number; evidence: number }): void {
  console.log(`${label}:`);
  console.log(`- sources: ${counts.sources}`);
  console.log(`- entities: ${counts.entities}`);
  console.log(`- collections: ${counts.collections}`);
  console.log(`- races: ${counts.races}`);
  console.log(`- positions: ${counts.positions}`);
  console.log(`- evidence: ${counts.evidence}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
