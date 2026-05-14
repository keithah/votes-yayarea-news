# v1 Race List Decision

**Status:** locked for M001/S01 launch planning  
**Election:** June 2, 2026 San Francisco Consolidated Statewide Direct Primary Election  
**Purpose:** Define the initial static route and data-fixture universe. Candidate/option counts remain `pending` until official or source-backed data is imported.

## Cutline policy

- **Ship** means the route/data fixture should exist for v1 and the UI must show data-completeness state if recommendations are thin.
- **Conditional ship** means include the route only if S03/S04 finds enough public source recommendations and evidence links.
- **Cut/defer** means outside the launch UI unless later data coverage makes it cheap and trustworthy.
- Never show a race as complete without source links, manual review, and data-completeness notes.

## Locked launch race universe

| Priority | Race / Contest | Slug | Race Type | Candidate / Option Count | Ship/Cut | Rationale / Notes |
|---:|---|---|---|---|---|---|
| 1 | San Francisco Mayor | mayor | local executive | pending | Ship | Primary demo race named in M001 acceptance; must support homepage, consensus snapshot, matrix, receipts, and AI-summary flow. |
| 2 | Local ballot measures | local-measures | ballot-measure collection | pending | Ship | Measures are part of the spec's major SF/local coverage and often have broad guide participation; create child slugs per measure once official labels are known. |
| 3 | Board of Supervisors District 2 | board-of-supervisors-d2 | local legislative | pending | Conditional ship | Include if the June 2026 ballot contains this district contest and source coverage is sufficient. |
| 4 | Board of Supervisors District 4 | board-of-supervisors-d4 | local legislative | pending | Conditional ship | Include if on the June 2026 ballot; otherwise cut before route generation. |
| 5 | Board of Supervisors District 6 | board-of-supervisors-d6 | local legislative | pending | Conditional ship | Include if on the June 2026 ballot; otherwise cut before route generation. |
| 6 | Board of Supervisors District 8 | board-of-supervisors-d8 | local legislative | pending | Conditional ship | Include if on the June 2026 ballot; otherwise cut before route generation. |
| 7 | Board of Supervisors District 10 | board-of-supervisors-d10 | local legislative | pending | Conditional ship | Include if on the June 2026 ballot; otherwise cut before route generation. |
| 8 | U.S. House — San Francisco congressional race(s) | us-house-sf | federal legislative | pending | Conditional ship | Spec prioritizes visible congressional races; split into district-specific slugs after official ballot/source mapping. |
| 9 | California Governor | california-governor | statewide executive | pending | Conditional ship | High-visibility statewide race; ship if SF voter guides provide enough comparable recommendations. |
| 10 | California Lieutenant Governor | california-lieutenant-governor | statewide executive | pending | Conditional ship | Lower priority than Governor; ship if recommendation coverage is meaningful. |
| 11 | California Attorney General | california-attorney-general | statewide executive | pending | Conditional ship | Ship only with enough sourced recommendations; otherwise defer to avoid sparse matrix. |
| 12 | California Secretary of State | california-secretary-of-state | statewide executive | pending | Conditional ship | Ship only with enough sourced recommendations. |
| 13 | California Controller | california-controller | statewide executive | pending | Conditional ship | Ship only with enough sourced recommendations. |
| 14 | California Treasurer | california-treasurer | statewide executive | pending | Conditional ship | Ship only with enough sourced recommendations. |
| 15 | California Insurance Commissioner | california-insurance-commissioner | statewide executive | pending | Conditional ship | Ship only with enough sourced recommendations. |
| 16 | California Superintendent of Public Instruction | california-superintendent-public-instruction | statewide education | pending | Conditional ship | Ship only if on the ballot and covered by enough sources. |
| 17 | State Board of Equalization — SF district | state-board-equalization-sf | statewide/tax board | pending | Cut/defer | Defer unless source coverage is unexpectedly strong and route cost is low. |
| 18 | Superior Court judicial contests | superior-court-judges | local judicial | pending | Cut/defer | Often sparse and sensitive; defer unless public guides provide clear, evidence-backed recommendations. |
| 19 | Party central committee / county committee contests | party-central-committee | party office | pending | Cut/defer | Too many candidates and too niche for launch unless a later cutline decision promotes it. |
| 20 | School board / community college board contests | education-board-races | local education | pending | Conditional ship | Include only if these offices appear on the June 2026 ballot and source coverage supports useful comparison. |
| 21 | BART / transit / regional board contests | regional-board-races | regional board | pending | Conditional ship | Include only if on the ballot and source coverage supports receipts-backed comparison. |

## Route planning notes for S02/S05

- Use stable collection slugs above for fixture scaffolding; split collection rows such as `local-measures`, `us-house-sf`, and `regional-board-races` into official child race slugs once ballot labels are confirmed.
- Candidate/option counts intentionally stay `pending`; S02 fixtures may use sample placeholders, but production data must replace them with official or source-backed counts.
- `Ship` and `Conditional ship` pages must visibly show completeness status. Conditional races may be hidden or marked incomplete after S04/S09 validation.
- `Cut/defer` rows should not block launch and should not create public broken-looking pages.
