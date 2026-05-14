# votes.yayarea.news — Product Design Spec v1

_Last updated: launch-planning revision_

## One-liner
The easiest way to understand what San Francisco voter guides, publications, clubs, and civic organizations are recommending — and why.

## Public Launch Target
**Next Monday.**

## Election Context
The product covers the **June 2, 2026 Consolidated Statewide Direct Primary Election** in San Francisco.

## Strategic Context
This is not the long-term company. This is the launch wedge for **yayarea.news**.

The election product should prove the core interaction model for the broader local-news aggregator:

- aggregate many Bay Area sources
- normalize messy source material
- synthesize recurring themes
- expose disagreement and consensus
- show receipts for every generated insight
- make complex local information feel understandable, visual, and trustworthy

The votes product is the first verticalized version of a broader future system for understanding Bay Area discourse.

---

# 1. Product Thesis

SF voters currently have to open a pile of tabs to understand what different organizations, publications, voter guides, and civic groups recommend.

**votes.yayarea.news** replaces that tab chaos with one clean, visual interface.

The product does not tell people how to vote. It shows:

- who is recommending whom
- which candidates and measures have broad recommendation support
- where source groups disagree
- why sources are making recommendations
- what original source material says
- where summaries are AI-assisted vs directly quoted

The product should feel like:

> Rotten Tomatoes + Spotify Wrapped + Apple News + FiveThirtyEight for SF election recommendations.

---

# 2. Core Positioning

## Public Positioning

**Understand SF election recommendations in minutes.**

A visual guide to what local publications, political clubs, advocacy groups, and civic organizations are recommending — with receipts.

## Internal Positioning

A thin vertical slice of the future yayarea.news platform.

This product prototypes reusable infrastructure for:

- source ingestion
- entity normalization
- claim/recommendation extraction
- AI-assisted synthesis
- evidence-linked summaries
- visual comparison interfaces
- shareable civic information cards

---

# 3. Product Goals

## Primary Goal
Help normal SF voters make sense of the June 2026 election recommendation landscape quickly and confidently.

## Secondary Goals

- Launch next Monday.
- Create something visually shareable.
- Establish trust through explicit AI disclosure.
- Prototype reusable yayarea.news architecture.
- Validate whether users want aggregated local civic/news intelligence.

## Success Feeling
Users should think:

- “This saves me hours.”
- “Finally, I understand the shape of this race.”
- “I can verify everything.”
- “This is actually beautiful.”
- “I would use this for other Bay Area news.”

---

# 4. Non-Goals

Do not build these for launch:

- voter matching quiz
- personalized recommendations
- user accounts
- donation data
- polling aggregation
- campaign finance tracker
- comments/social features
- full historical analytics
- advanced coalition graph
- automated ideology scoring
- statewide expansion
- general news aggregation UI
- perfect scraping infrastructure

The v1 launch should be a focused, beautiful, trustworthy election recommendation explorer.

---

# 5. Product Principles

## 5.1 Aggregate, Don’t Endorse

The product summarizes published recommendations. It does not issue its own candidate or measure recommendations.

Avoid language like:

- “best candidate”
- “top choice”
- “you should vote for”
- “strongest candidate”

Prefer language like:

- “most recommended”
- “frequently recommended”
- “commonly cited”
- “sources often mention”
- “recommendation consensus”

## 5.2 Verifiability First

Every generated insight must have receipts.

Users should be able to click from:

> AI-generated theme

into:

> supporting quotes → original voter guide/source URL

## 5.3 Explicit AI Disclosure

AI is used as a research assistant, not an editorial voice.

The product must clearly disclose:

- where AI is used
- what AI does
- what AI does not do
- when humans reviewed output

## 5.4 Preserve Nuance Internally

SF recommendations are messy:

- ranked-choice endorsements
- dual endorsements
- acceptable alternatives
- lean support
- no endorsement
- informational voter guides

The system should preserve these distinctions internally, even if the UI simplifies them.

## 5.5 Progressive Disclosure

Default view: approachable and visual.

Power-user view: matrix, filters, source quotes, raw data.

The matrix is important, but normal voters should not be forced to decode a giant spreadsheet first.

## 5.6 Source Groups Matter

Do not present all sources as identical.

A recommendation from a newspaper editorial board, a labor union, a Democratic club, a housing org, and a nonpartisan civic guide are different kinds of signals.

The UI should group by source type and let users filter accordingly.

## 5.7 Reusable Platform Primitives

The backend should not be election-specific.

Build around generalized concepts:

- Source
- Artifact
- Entity
- Collection
- Position / Claim
- Evidence
- Summary
- Theme
- Embedding
- Extraction Run

Election-specific concepts like Race, Candidate, Measure, and Endorsement should be implemented as types of these generalized primitives.

---

# 6. Brand & Visual Direction

## 6.1 Brand Architecture

Launch at:

**votes.yayarea.news**

Relationship:

- votes = election vertical
- yayarea.news = future parent local-news aggregator

## 6.2 Visual Personality

Target blend:

- Linear / Stripe / Apple News polish
- Spotify Wrapped / Letterboxd playfulness
- FiveThirtyEight clarity
- local Bay Area civic energy

## 6.3 Tone

Smart, clear, friendly, slightly fun.

Not:

- government website
- activist pamphlet
- academic report
- cable-news punditry
- overly snarky local politics Twitter

## 6.4 Theme

Support both:

- dark mode
- light mode

Dark mode can be the default if it makes the matrix and share cards feel more distinctive.

## 6.5 Visual Motifs

Potential motifs:

- cards
- meters
- source chips
- receipt drawers
- colorful source categories
- compact matrices
- shareable screenshots
- election “scoreboard” feel without implying the site endorses anyone

---

# 7. Primary Users

## 7.1 Normal SF Voter

Needs:

- quick understanding
- low jargon
- mobile-friendly summaries
- confidence that data is sourced

Primary use case:

> “I got my ballot and want to understand what trusted groups are recommending.”

## 7.2 Engaged Civic User

Needs:

- compare source groups
- inspect disagreements
- read quotes
- filter by source category

Primary use case:

> “I want to see how GrowSF, the League, the Chronicle, and labor groups differ.”

## 7.3 Political Nerd / Journalist / Campaign Staffer

Needs:

- matrix
- raw source material
- exportable/shareable views
- source-level detail

Primary use case:

> “I want to see the shape of the recommendation ecosystem.”

---

# 8. MVP Scope

## 8.1 Geography

San Francisco only.

## 8.2 Election Context

June 2, 2026 Primary Election.

## 8.3 Launch Deadline

Launch next Monday with the best available recommendation data.

Incomplete data is acceptable if clearly disclosed.

## 8.4 Coverage

Target all major SF races and major SF/local measures.

If time forces prioritization, prioritize:

1. most visible congressional/state/local contests
2. Board of Supervisors races
3. local ballot measures
4. other races as source data allows

## 8.5 Source Philosophy

Initial source set should be recognizable and credible.

Do not ingest every random blog or social post for launch.

The goal is not maximum quantity. The goal is useful voter signal.

## 8.6 Source Categories

Initial categories:

- Media / Editorial
- Civic / Nonpartisan
- Democratic Clubs
- Labor
- Housing / Urbanism
- Advocacy / Issue Groups
- Party / Institutional

Each source should have metadata:

- name
- category
- website
- guide URL
- publication date
- source type
- geography
- notes
- logo/icon if available

---

# 9. Information Architecture

## 9.1 Homepage

URL: `/`

### Goal
Give users the election landscape in less than five minutes.

### Required Modules

#### Hero

Copy direction:

> Understand what SF organizations are recommending — and why.

Subcopy:

> We aggregate public voter guides and endorsements, summarize recurring themes, and link every insight back to the original source.

Primary CTA:

> Explore races

Secondary CTA:

> How we use AI

#### Election Status Banner

Show:

- election date
- launch/update timestamp
- number of sources tracked
- number of recommendations parsed
- data completeness note

Example:

> Tracking 18 sources across 12 races. Last updated May 18, 2026.

#### Featured Races

Cards showing:

- race name
- most recommended candidate/option
- consensus meter
- number of sources
- disagreement indicator

#### Most Unified

Races/measures with high consensus.

#### Most Divided

Races/measures where source groups split.

#### Latest Recommendations

Recent source additions or updates.

#### Source Explorer

Grid of source cards grouped by source type.

---

## 9.2 Race Page

URL pattern:

`/races/[race-slug]`

This is the core product page.

### Page Goal
Help a user understand a race in 30–60 seconds, then let them dig deeper.

### Section A — Race Header

Includes:

- race name
- election date
- candidate/option count
- number of sources tracked
- last updated timestamp
- data completeness status

Example:

> Mayor of San Francisco  
> 9 candidates · 21 sources tracked · Last updated May 18

### Section B — Consensus Snapshot

This is the most important launch UI element.

Rotten Tomatoes-inspired, but carefully worded as recommendations, not endorsements by the site.

Displays:

- most recommended candidate/option
- overall recommendation share
- source-type breakdown
- consensus strength
- number of sources with no position

Example language:

> Most recommended: Candidate A  
> Recommended by 13 of 21 tracked sources.

Breakdown:

| Source Type | Candidate A | Candidate B | No Position |
|---|---:|---:|---:|
| Media | 3 | 1 | 1 |
| Labor | 1 | 3 | 0 |
| Housing / Urbanism | 5 | 0 | 1 |
| Democratic Clubs | 4 | 2 | 3 |

### Section C — AI Summary Drawer

Default: collapsed.

CTA:

> Show AI-generated summary

When expanded:

- visible AI label
- short disclosure
- recurring positive themes
- recurring criticisms/concerns
- links to supporting quotes

Header:

> AI-generated summary of recurring recommendation themes

Disclosure:

> This summary was generated from published voter guides and reviewed before publication. It is not a voting recommendation. Expand any theme to see supporting quotes.

Content structure:

- Common reasons sources recommend Candidate A
- Common concerns or criticisms
- Notable disagreements between source groups
- Supporting receipts

### Section D — Recommendation Matrix

This is the signature explorer.

Default sorting: recommendation similarity first.

Rows:

- sources

Columns:

- candidates/options

Cell states:

| UI State | Internal Meaning |
|---|---|
| Recommended | endorse, ranked_1 |
| Secondary / acceptable | ranked_2, ranked_3, acceptable, dual_endorsement |
| Opposed | oppose, reject |
| Informational | informational |
| No position | neutral, unavailable |

Interactions:

- hover/click cell for quote
- expand row for source rationale
- filter by source type
- toggle grouped by source type
- toggle sorted by recommendation similarity
- mobile stacked-card view
- screenshot/share mode

Priority: beautiful first, functional second.

The matrix should be visually distinctive enough to share as a screenshot.

### Section E — Source Quotes / Receipts

A receipts drawer/list showing:

- source name
- recommendation
- quote/excerpt
- link to original guide
- publication date
- verification status

This section makes the AI summaries trustworthy.

### Section F — Related Pages

Links to:

- candidate/measure pages
- source pages
- other races

---

## 9.3 Candidate / Measure Page

URL pattern:

`/entities/[entity-slug]`

Candidate and measure pages use the same core template.

### Page Goal
Show everything tracked about one candidate or measure option across all races/sources.

### Sections

#### Header

- name
- type: candidate / measure / measure option
- race
- basic metadata

#### Recommendation Overview

- total recommendations
- source-type breakdown
- ranked/secondary support
- opposition/concerns if present

#### Why Sources Recommend This Candidate/Option

AI summary, collapsed by default.

#### Source Recommendations

List of all source excerpts and links.

#### Matrix Context

Mini matrix showing this candidate/option compared to alternatives in the race.

---

## 9.4 Source Page

URL pattern:

`/sources/[source-slug]`

### Page Goal
Show what one source recommends and provide source context.

### Sections

- source metadata
- source category
- guide URL
- publication date
- all parsed recommendations
- quotes/excerpts
- verification status

### MVP Exclusions

Do not include advanced ideology labels or historical drift at launch.

---

## 9.5 How We Use AI Page

URL: `/how-we-use-ai`

This is required for launch.

### Purpose
Build trust by being unusually explicit.

### Must Say

We use AI to:

- extract recommendations from voter guides
- identify recurring themes
- group similar rationales
- retrieve supporting quotes
- draft summaries for review

We do not use AI to:

- decide who voters should support
- rank candidates by quality
- secretly weight sources
- generate unsupported claims
- replace source links

### Suggested Copy

> AI helps us organize public voter-guide information. It does not decide which candidates or measures are good, and it does not make voting recommendations. Every AI-generated summary is based on source material and should link back to original quotes or voter guides.

---

# 10. Data & Architecture

## 10.1 Foundational Rule

Do not architect this as only an election app.

Architect it as:

> Source → Artifact → Entity → Position / Claim → Evidence → Summary

This lets votes become the first vertical of yayarea.news.

---

## 10.2 Core Objects

### Source

A publication, organization, club, union, advocacy group, government body, newsletter, podcast, etc.

```ts
Source {
  id: string
  name: string
  slug: string
  url: string
  category: SourceCategory
  geography?: string
  description?: string
  logoUrl?: string
  createdAt: string
  updatedAt: string
}
```

### Artifact

A source-produced item.

For votes:

- voter guide
- endorsement page
- PDF guide
- editorial endorsement page

For future yayarea.news:

- article
- newsletter
- podcast episode
- blog post
- press release

```ts
Artifact {
  id: string
  sourceId: string
  type: 'voter_guide' | 'endorsement_page' | 'article' | 'newsletter' | 'pdf' | 'other'
  title: string
  url: string
  publishedAt?: string
  capturedAt: string
  rawText?: string
  rawHtmlPath?: string
  status: ReviewStatus
}
```

### ArtifactChunk

A chunk of artifact text used for extraction, embeddings, and evidence.

```ts
ArtifactChunk {
  id: string
  artifactId: string
  text: string
  index: number
  startOffset?: number
  endOffset?: number
  embeddingId?: string
}
```

### Entity

A person, candidate, measure, organization, neighborhood, issue, company, etc.

```ts
Entity {
  id: string
  type: 'candidate' | 'measure' | 'measure_option' | 'organization' | 'person' | 'place' | 'issue' | 'other'
  name: string
  slug: string
  aliases: string[]
  metadata?: Record<string, unknown>
}
```

### Collection

A grouping object.

For votes:

- election
- race

For future yayarea.news:

- topic
- story cluster

```ts
Collection {
  id: string
  type: 'election' | 'race' | 'topic' | 'story_cluster'
  name: string
  slug: string
  parentId?: string
  date?: string
  metadata?: Record<string, unknown>
}
```

### Position / Claim

A structured stance extracted from a source artifact.

For votes:

- recommendation
- opposition
- ranked endorsement
- no position

For future news:

- claim
- criticism
- support
- concern
- narrative framing

```ts
Position {
  id: string
  sourceId: string
  artifactId: string
  collectionId?: string
  entityId: string
  positionType: PositionType
  rank?: number
  confidence: number
  status: ReviewStatus
  evidenceIds: string[]
  notes?: string
  createdAt: string
  updatedAt: string
}
```

### PositionType

```ts
PositionType =
  | 'endorse'
  | 'ranked_1'
  | 'ranked_2'
  | 'ranked_3'
  | 'acceptable'
  | 'dual_endorsement'
  | 'lean_support'
  | 'oppose'
  | 'reject'
  | 'neutral'
  | 'informational'
  | 'unknown'
```

### Evidence

First-class receipt object.

```ts
Evidence {
  id: string
  artifactId: string
  chunkId?: string
  excerptText: string
  url: string
  capturedAt: string
  startOffset?: number
  endOffset?: number
  status: ReviewStatus
}
```

### Theme

A recurring theme extracted from evidence.

```ts
Theme {
  id: string
  collectionId?: string
  entityId?: string
  label: string
  description?: string
  evidenceIds: string[]
  generatedByRunId?: string
  status: ReviewStatus
}
```

### Summary

AI-assisted generated text.

```ts
Summary {
  id: string
  targetType: 'race' | 'entity' | 'source' | 'topic'
  targetId: string
  text: string
  evidenceIds: string[]
  generatedByRunId: string
  status: ReviewStatus
  reviewedAt?: string
}
```

### Embedding

Used for semantic clustering and retrieval.

```ts
Embedding {
  id: string
  targetType: 'artifact' | 'chunk' | 'evidence' | 'position'
  targetId: string
  model: string
  vectorPath?: string
  createdAt: string
}
```

### ExtractionRun

Every automated run should be auditable.

```ts
ExtractionRun {
  id: string
  sourceId?: string
  artifactId?: string
  runType: 'scrape' | 'extract_positions' | 'embed' | 'cluster_themes' | 'generate_summary'
  model?: string
  promptVersion?: string
  codeVersion?: string
  status: 'success' | 'failed' | 'partial'
  startedAt: string
  completedAt?: string
  logsPath?: string
}
```

### ReviewStatus

```ts
ReviewStatus = 'draft' | 'needs_review' | 'verified' | 'rejected' | 'published'
```

---

# 11. Static-First Architecture

## 11.1 Preferred Launch Architecture

The launch version should be static-first and GitHub-native.

Suggested shape:

- static site generated from JSON/Markdown data
- GitHub repo as source of truth
- GitHub Actions for scraping/extraction/build
- static hosting via GitHub Pages, Cloudflare Pages, Netlify, or Vercel static output
- manual override files committed to repo

## 11.2 Why Static First

Benefits:

- fast launch
- easy deploys
- transparent data files
- no database required for v1
- simple review via pull requests
- good for a solo maintainer
- easier to debug and archive

## 11.3 Static Data Structure

Suggested repository structure:

```txt
/data
  /sources
    growsf.json
    sf-chronicle.json
  /artifacts
    growsf-2026-guide.json
  /entities
    candidates.json
    measures.json
  /collections
    election-2026-primary.json
    races.json
  /positions
    mayor.json
    prop-a.json
  /evidence
    mayor.json
  /summaries
    mayor.json
  /embeddings
    manifest.json
/manual
  overrides.json
  source-notes.md
/scripts
  scrape.ts
  extract.ts
  embed.ts
  summarize.ts
  build-static.ts
/site
  ...frontend
```

## 11.4 Manual Overrides

Manual overrides are essential for launch.

Use them for:

- source URL corrections
- candidate alias matching
- race mapping
- endorsement corrections
- quote cleanup
- summary edits
- hide/publish toggles

Manual data should always win over automated extraction.

## 11.5 GitHub Actions Pipeline

Suggested flow:

```txt
scheduled/manual trigger
→ scrape sources
→ extract artifact text
→ chunk text
→ extract positions
→ generate embeddings
→ cluster themes
→ draft summaries
→ apply manual overrides
→ run validation
→ build static site
→ deploy
```

For launch, this can be simplified:

```txt
manual source list
→ scrape/extract
→ manual review JSON
→ build static site
→ deploy
```

---

# 12. Embeddings Strategy

Use embeddings, but only as infrastructure — not judgment.

## Use Embeddings For

- grouping similar endorsement rationales
- duplicate / near-duplicate detection
- semantic quote retrieval
- clustering evidence into themes
- future story clustering for yayarea.news

## Do Not Use Embeddings For

- ranking candidates
- weighting sources
- deciding recommendations
- voter matching
- ideology scores
- hidden scoring

## Product Disclosure

Suggested language:

> We may use embeddings to group similar source language and retrieve supporting quotes. Embeddings are not used to decide which candidates are recommended, weight sources, or generate voting recommendations.

---

# 13. AI Pipeline

## 13.1 AI Tasks

Allowed:

- extracting recommendations
- identifying candidate/measure mentions
- extracting quotes
- clustering recurring themes
- drafting summaries from evidence
- retrieving receipts

Forbidden:

- inventing facts
- making voting recommendations
- ranking candidate quality
- predicting winners
- inferring ideology beyond evidence
- generating claims without evidence

## 13.2 Summary Rules

Every AI summary must:

- be collapsed by default
- be labeled as AI-generated
- cite evidence
- avoid normative language
- be human-reviewed before publishing

## 13.3 Prompt Constraints

Prompts should explicitly say:

- only use provided source text
- do not infer beyond text
- do not make recommendations
- do not rank candidates
- summarize recurring themes only
- include evidence IDs for every claim
- return uncertainty when evidence is insufficient

---

# 14. Admin / Review Workflow

Since the initial reviewer is just Keith, keep this simple.

## 14.1 Minimum Viable Admin

Could be:

- JSON files
- Markdown files
- local script output
- GitHub PR review

No need for a full CMS before launch.

## 14.2 Required Review Actions

Keith needs to be able to:

- approve/reject extracted recommendation
- edit recommendation type
- fix candidate/race mapping
- attach or edit evidence quote
- mark source as published/unpublished
- edit AI summary text
- mark summary as verified
- flag ambiguous cases

## 14.3 Display Statuses

Frontend should only show:

- verified
- published

Optionally show:

- “AI parsed”
- “Human reviewed”

Do not show unreviewed draft summaries on launch pages.

---

# 15. Matrix Design

## 15.1 Design Priority

Beautiful first. Functional second.

The matrix should be:

- legible
- colorful
- screenshot-worthy
- mobile-adapted
- emotionally understandable

## 15.2 Default Sort

Sort sources by recommendation similarity first.

Then allow toggles:

- group by source type
- sort alphabetically
- sort by recently updated

## 15.3 Cell Display

Use compact visual symbols or colored pills.

Possible labels:

- Recommended
- Ranked
- Acceptable
- Opposed
- Info only
- No position

Avoid relying only on color for accessibility.

## 15.4 Mobile Matrix

Do not force a wide spreadsheet on mobile.

Use stacked candidate cards:

- candidate name
- recommendation count
- source-type breakdown
- expandable list of source recommendations

Then provide an “Open full matrix” option.

---

# 16. Consensus Meter Design

## 16.1 Purpose

The consensus meter is the fastest way for a voter to understand the recommendation landscape.

## 16.2 Language

Use:

- “Most recommended”
- “Recommended by X of Y tracked sources”
- “Source groups are split”
- “Strong consensus”
- “Mixed recommendations”

Avoid:

- “winner”
- “best”
- “top candidate”
- “our pick”

## 16.3 Breakdown

Always show source-type breakdown so users understand composition.

Example:

```txt
Candidate A
Recommended by 13 of 21 sources

Media: 3/5
Labor: 1/4
Housing: 5/6
Clubs: 4/6
```

---

# 17. Share Cards

Every race should have a shareable card at launch.

## 17.1 Share Card Types

- Race consensus card
- Most divided race card
- Matrix screenshot card
- Source breakdown card

## 17.2 Requirements

Cards should include:

- votes.yayarea.news branding
- race name
- last updated date
- “recommendations, not endorsements by us” microcopy
- clean visual hierarchy

---

# 18. Analytics

Use anonymous analytics from day one.

Track:

- race page views
- matrix opens
- AI summary expands
- receipt drawer opens
- source filter usage
- share clicks
- source outbound clicks
- mobile vs desktop usage

Good tools:

- Plausible
- PostHog
- Umami

Avoid creepy tracking.

---

# 19. Launch Plan

## Day 1 — Scope Lock

- finalize source list
- finalize race list
- finalize data schema
- create visual direction
- build initial homepage/race mock

## Day 2 — Data Pipeline

- create source JSON files
- scrape/import guides
- extract text
- normalize candidates/races
- generate initial positions

## Day 3 — Core UI

- homepage
- race page
- consensus meter
- matrix
- mobile race cards

## Day 4 — AI + Receipts

- evidence extraction
- embeddings for quote retrieval/theme clustering
- AI summaries
- collapsed summary drawer
- receipts drawer
- `/how-we-use-ai`

## Day 5 — Candidate/Measure/Source Pages

- entity page template
- source page template
- related links
- metadata display

## Day 6 — QA + Polish

- verify data
- fix source mappings
- review every visible AI summary
- accessibility pass
- share cards
- dark/light mode

## Day 7 — Launch Prep

- final data refresh
- social screenshots
- launch post
- analytics
- deploy
- monitor corrections

---

# 20. Launch Cutline

If time gets tight, prioritize in this order:

1. Race pages
2. Consensus meter
3. Recommendation matrix
4. Source quotes/receipts
5. How we use AI page
6. Homepage
7. Candidate/measure pages
8. Source pages
9. Share cards
10. Advanced filters

Never cut:

- source links
- AI disclosure
- manual review
- data completeness notes

---

# 21. Open Questions

These can be resolved during implementation:

- exact initial source list
- exact race list
- default dark vs light theme
- final source category colors
- whether matrix cells use icons, pills, or both
- how many recommendations are enough before a race page is marked “complete”
- whether to include incomplete races at launch or hide until enough data exists

---

# 22. North Star

In 30 seconds, a normal SF voter should understand:

- which candidates/options are most recommended
- which source groups support them
- why they are being recommended
- where disagreement exists
- how to verify the underlying source material

Long term, this becomes the foundation for:

> the interface for understanding Bay Area discourse.

