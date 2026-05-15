# Manual overrides

`manual/overrides/` contains committed review-time overrides that are applied after the canonical JSON in `data/public/` during static data loading.

These files are not a production CMS and should not be treated as an independent source for election facts. They exist so reviewed, evidence-backed public records and fixture-only display tweaks can exercise merge behavior before a real editorial workflow exists.

## Merge order

1. Load and validate canonical records from `data/public/`.
2. Load the matching override file from `manual/overrides/<collection>/<slug>.json` when it exists.
3. Merge override fields over canonical fields.
4. Validate the merged repository before any loader returns data.

Object fields are merged recursively. Arrays of objects with `id` fields are merged by `id`: a matching override updates the canonical record, while a new `id` appends a new record and must still pass validation.

## Publication rules for positions

Overrides may publish only records that have passed the local review workflow:

- Public position records must be `status: "verified"` or `status: "published"` and `publicationStatus: "public"`.
- Public position records must include evidence. A visible endorsement, opposition, informational note, or explicit no-position claim without evidence is invalid even if the JSON schema accepts its shape.
- Evidence should preserve source, artifact, and chunk provenance for ingested artifacts. Run `pnpm review:coverage` or `pnpm verify:s03` to surface partial or absent provenance.
- Explicit source-backed “No Endorsement,” “No Recommendation,” or equivalent records are represented as `kind: "no-position"` with evidence and normal review/publication status.
- Empty matrix cells are not override records. Leave them absent so public presentation can render `no-public-position` placeholders without IDs, receipts, or invented claims.
- Sources marked `pending`, `unavailable`, or `manual-only` in `data/ingestion/source-coverage.json` must not produce public recommendation records until real public guide artifacts exist and are captured or otherwise documented through the approved review path.

## Review caveats

- Missing override files are allowed and mean “use canonical data only.”
- Malformed override JSON is a build/test error and should include the `manual/overrides/...` path.
- Overrides must not invent official election facts or recommendation claims. Use them only for reviewed public positions, local review notes, fixture labels, or clearly marked sample data until a real editorial system exists.
- Public loaders still filter draft, hidden, rejected, or merely reviewed records out of public UI surfaces.
- `data/reviewed/position-coverage.json` is the audit artifact for current public position counts by kind/status, unsupported public records, evidence gaps, provenance gaps, and source coverage constraints.
