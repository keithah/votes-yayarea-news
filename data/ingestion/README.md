# Source ingestion fixtures

`data/ingestion/` contains deterministic inputs for the source-ingestion pipeline. These files are committed so tests and future ingestion commands can run without network access.

## Important sample-data rule

The HTML fixtures in this directory are **representative samples only**. They are not official 2026 election claims, endorsements, recommendations, or voter-guide content. They exist to exercise ingestion behavior against the public source IDs currently defined in `data/public/sources.json`.

## Layout

- `manifest.json` — maps public `sourceId` values to fixture files and stable artifact IDs.
- `fixtures/*.html` — representative source-guide HTML with boilerplate, scripts/styles, headings, and body text for cleaner/chunker tests.

Generated ingestion outputs belong under `data/ingested/` in later tasks, not in this directory.
