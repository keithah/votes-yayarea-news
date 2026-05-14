import { validatePublicDataFiles } from "../lib/data/validate";

async function main(): Promise<void> {
  const result = await validatePublicDataFiles();

  console.log("Checked files:");
  for (const file of result.checkedFiles.slice().sort()) {
    console.log(`- ${file}`);
  }

  console.log("Counts:");
  console.log(`- sources: ${result.counts.sources}`);
  console.log(`- entities: ${result.counts.entities}`);
  console.log(`- collections: ${result.counts.collections}`);
  console.log(`- races: ${result.counts.races}`);
  console.log(`- positions: ${result.counts.positions}`);
  console.log(`- evidence: ${result.counts.evidence}`);

  if (!result.ok) {
    console.error("Validation failures:");
    for (const issue of result.issues) {
      console.error(`- ${issue.path}: [${issue.code}] ${issue.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Validation passed.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
