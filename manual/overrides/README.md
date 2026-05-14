# Manual overrides

`manual/overrides/` contains local, committed fixture overrides that are applied after the canonical JSON in `data/public/` during static data loading.

These files are not a production CMS and should not be treated as an authoritative source for election facts. They exist so review-time corrections and fixture-only display tweaks can exercise merge behavior before a real editorial workflow exists.

## Merge order

1. Load and validate canonical records from `data/public/`.
2. Load the matching override file from `manual/overrides/<collection>/<slug>.json` when it exists.
3. Merge override fields over canonical fields.
4. Validate the merged repository before any loader returns data.

Object fields are merged recursively. Arrays of objects with `id` fields are merged by `id`: a matching override updates the canonical record, while a new `id` appends a new record and must still pass validation.

## Review caveats

- Missing override files are allowed and mean “use canonical data only.”
- Malformed override JSON is a build/test error and should include the `manual/overrides/...` path.
- Overrides must not invent official election facts. Use them for local review notes, fixture labels, or clearly marked sample data until a real editorial system exists.
- Public loaders still filter draft, hidden, rejected, or merely reviewed records out of public UI surfaces.
