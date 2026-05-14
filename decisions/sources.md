# v1 Source List Decision

**Status:** locked for M001/S01 launch planning  
**Election:** June 2, 2026 San Francisco Consolidated Statewide Direct Primary Election  
**Purpose:** Define the first public-source universe for manual ingestion and review. This is a launch scope artifact, not a claim that every source has already published its 2026 guide.

## Inclusion rules

- Track recognizable San Francisco or Bay Area voter-guide, editorial, civic, political club, labor, housing/urbanism, advocacy, party, or institutional sources.
- Use public voter guides, endorsement pages, editorials, or official recommendation pages as artifacts.
- Mark guide URLs and publication dates as `pending` when a 2026 guide is not yet located; do not invent publication dates.
- Exclude random blogs, individual social posts, private slates, and sources without inspectable public receipts for v1.
- Manual source notes and overrides may refine exact artifact URLs later, but this file is the locked initial source universe for S03 ingestion.

## Active source categories

| Name | Category | Guide URL | Publication Date | Source Type | v1 Inclusion / Exclusion Note |
|---|---|---|---|---|---|
| San Francisco Chronicle Editorial Board | Media / Editorial | pending 2026 voter-guide or endorsement URL | pending | editorial endorsements | Include for launch if public June 2026 endorsement pages are available; high-recognition media signal. |
| Mission Local | Media / Editorial | pending 2026 voter-guide or election coverage URL | pending | publication guide / election coverage | Include if recommendation or guide material is public; otherwise keep as source-notes-only until a usable artifact exists. |
| San Francisco Standard | Media / Editorial | pending 2026 voter-guide or election coverage URL | pending | publication guide / election coverage | Include if public recommendations or structured election guide exists; otherwise document as pending. |
| League of Women Voters of San Francisco / Voter's Edge | Civic / Nonpartisan | pending 2026 San Francisco election guide URL | pending | nonpartisan voter guide | Include for candidate/measure information and nonpartisan context; recommendation fields may be informational rather than endorsements. |
| SPUR Voter Guide | Civic / Nonpartisan | pending 2026 voter-guide URL | pending | civic voter guide | Include for measure and policy-focused recommendations if published. |
| GrowSF Voter Guide | Civic / Nonpartisan | pending 2026 voter-guide URL | pending | civic voter guide / recommendations | Include as a recognizable local guide with broad race/measure coverage. |
| San Francisco Democratic Party | Party / Institutional | pending 2026 endorsement URL | pending | party endorsement slate | Include for official Democratic Party recommendations where public. |
| San Francisco Republican Party | Party / Institutional | pending 2026 endorsement URL | pending | party endorsement slate | Include if public recommendations are available; useful party/institutional contrast even if coverage is partial. |
| Harvey Milk LGBTQ Democratic Club | Democratic Clubs | pending 2026 endorsement URL | pending | club endorsement slate | Include as an active Democratic club source if public slate is available. |
| Alice B. Toklas LGBTQ Democratic Club | Democratic Clubs | pending 2026 endorsement URL | pending | club endorsement slate | Include as an active Democratic club source if public slate is available. |
| San Francisco Berniecrats | Democratic Clubs | pending 2026 endorsement URL | pending | club endorsement slate | Include as a progressive Democratic club source if public slate is available. |
| United Democratic Club | Democratic Clubs | pending 2026 endorsement URL | pending | club endorsement slate | Include as a Democratic club source if public slate is available. |
| San Francisco Labor Council | Labor | pending 2026 endorsement URL | pending | labor endorsement slate | Include as primary labor umbrella source if public recommendations are available. |
| SEIU Local 1021 | Labor | pending 2026 endorsement URL | pending | union endorsement slate | Include if public local/state recommendations are available. |
| United Educators of San Francisco | Labor | pending 2026 endorsement URL | pending | union endorsement slate | Include if public recommendations are available, especially education/local races and measures. |
| YIMBY Action / SF YIMBY | Housing / Urbanism | pending 2026 endorsement URL | pending | advocacy endorsement slate | Include for housing/urbanism signal if public slate is available. |
| SF Tenants Union | Housing / Urbanism | pending 2026 voter-guide or endorsement URL | pending | advocacy voter guide | Include for tenant/housing signal if public recommendations are available. |
| Housing Action Coalition | Housing / Urbanism | pending 2026 endorsement URL | pending | advocacy endorsement slate | Include if public candidate/measure recommendations are available. |
| Sierra Club Bay Chapter | Advocacy / Issue Groups | pending 2026 endorsement URL | pending | issue-group endorsement slate | Include for environmental recommendations if public and SF-relevant. |
| San Francisco Bicycle Coalition | Advocacy / Issue Groups | pending 2026 voter-guide or endorsement URL | pending | issue-group voter guide | Include for transportation/street-safety signal if public recommendations are available. |
| TogetherSF Action | Advocacy / Issue Groups | pending 2026 voter-guide or endorsement URL | pending | advocacy recommendation slate | Include if public recommendations are available; likely useful for local race/measure coverage. |
| ACLU of Northern California | Advocacy / Issue Groups | pending 2026 voter-guide or measure-guide URL | pending | issue guide / recommendations | Include if a public SF-relevant guide exists; otherwise keep as pending because coverage may be issue-specific. |

## Excluded or deferred categories for v1

| Category | Decision | Rationale |
|---|---|---|
| Individual candidate campaign sites | Excluded | Campaign pages are primary-source campaign material, not independent recommendation sources. Use only as entity metadata if needed later. |
| Social-only endorsements | Excluded | Harder to preserve receipts and publication metadata reliably for launch. |
| Random blogs / personal newsletters | Excluded by default | May be added after launch if recognizable, public, and receipt-friendly; not part of the locked initial universe. |
| Statewide-only guides with no SF-local coverage | Deferred | Can be added if they materially cover locked SF races or measures; otherwise they dilute launch focus. |

## S03 ingestion notes

- `pending` guide URLs should become explicit artifact URLs before extraction; if a source has no public 2026 artifact, mark it manual-only or excluded in source notes.
- Civic/nonpartisan sources may produce informational records rather than recommendations; preserve that distinction instead of forcing endorsement semantics.
- Every ingested recommendation still needs evidence text, source URL, publication date or pending status, and review status before public display.
