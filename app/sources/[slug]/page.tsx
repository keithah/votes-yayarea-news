import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listRaceSlugs, loadPublicRaceContext, type LoadedPublicRaceContext, type LoaderOptions } from "../../../lib/data/loaders";
import { buildSourceShareMetadata } from "../../../lib/share/metadata";
import { buildSourceDrilldownModel, type DrilldownPositionGroup, type SourceDrilldownModel } from "../../../lib/ui/drilldowns";

export const dynamic = "force-static";

export interface SourcePageModel extends SourceDrilldownModel {
  checkedFiles: string[];
  diagnostics: SourceDrilldownModel["diagnostics"] & {
    checkedFileCount: number;
  };
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const contexts = await loadPublicRaceContexts();
  const slugs = new Set<string>();
  for (const context of contexts) {
    const publicSourceIds = new Set(context.race.positions.map((position) => position.sourceId));
    for (const source of context.sources) {
      if (publicSourceIds.has(source.id)) slugs.add(source.slug);
    }
  }
  return [...slugs].sort().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const model = await buildSourcePageModel(slug);
  return buildSourceShareMetadata(model, `/sources/${slug}/`);
}

export async function buildSourcePageModel(slug: string, options: LoaderOptions = {}): Promise<SourcePageModel | null> {
  const contexts = await loadPublicRaceContexts(options);
  const model = buildSourceDrilldownModel(contexts, slug);
  if (model.availability !== "available") return null;

  const checkedFiles = uniqueSorted(contexts.flatMap((context) => context.checkedFiles));
  return {
    ...model,
    checkedFiles,
    diagnostics: {
      ...model.diagnostics,
      checkedFileCount: checkedFiles.length,
    },
  };
}

export default async function SourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const model = await buildSourcePageModel(slug);

  if (!model) notFound();

  const { source, counts, diagnostics, relatedRaces, relatedEntities, positions, checkedFiles } = model;
  if (!source) notFound();

  const externalHref = source.guideUrl ?? source.homepageUrl;

  return (
    <main
      className="race-page-shell drilldown-page-shell"
      data-drilldown-kind="source"
      data-drilldown-slug={model.slug}
      data-related-race-count={diagnostics.relatedRaceCount}
      data-recommendation-count={diagnostics.publicPositionCount}
      data-evidence-count={diagnostics.evidenceCount}
      data-checked-file-count={diagnostics.checkedFileCount}
    >
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <span>Sources</span>
        <span aria-hidden="true">/</span>
        <span>{source.name}</span>
      </nav>

      <section className="race-hero" aria-labelledby="source-title">
        <div className="race-hero-copy">
          <p className="eyebrow">Source drill-down</p>
          <h1 id="source-title">{source.name}</h1>
          <p className="lede">
            Public, verified recommendation receipts attributed to this source, with links back to the races and entities they mention.
          </p>
          {source.notes ? <p className="muted-copy">{source.notes}</p> : null}
          {externalHref ? <a className="drilldown-primary-link" href={externalHref}>Visit public source</a> : null}
        </div>

        <aside className="consensus-panel" aria-labelledby="source-counts-title">
          <p className="panel-kicker">Published recommendation trail</p>
          <h2 id="source-counts-title">{counts.publicPositionCount} recommendations</h2>
          <dl className="race-meta" aria-label="Source recommendation counts">
            <div>
              <dt>Related races</dt>
              <dd>{counts.relatedRaceCount}</dd>
            </div>
            <div>
              <dt>Entities</dt>
              <dd>{counts.entityCount}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>{counts.evidenceCount}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{source.status}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <DiagnosticsPanel diagnostics={diagnostics} />

      <section className="drilldown-grid" aria-label="Related public records">
        <RelatedRaces races={relatedRaces} />
        <RelatedEntities entities={relatedEntities} />
      </section>

      <PositionReceipts positions={positions} />

      <CheckedFiles files={checkedFiles} />
    </main>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: SourcePageModel["diagnostics"] }) {
  return (
    <section className="route-diagnostics" aria-labelledby="source-diagnostics-title">
      <div className="section-heading">
        <p className="eyebrow">Visible diagnostics</p>
        <h2 id="source-diagnostics-title">What reached the static source route</h2>
      </div>
      <dl className="metric-grid">
        <div>
          <dt>Slug</dt>
          <dd>{diagnostics.requestedSlug}</dd>
        </div>
        <div>
          <dt>Recommendations</dt>
          <dd>{diagnostics.publicPositionCount}</dd>
        </div>
        <div>
          <dt>Related races</dt>
          <dd>{diagnostics.relatedRaceCount}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{diagnostics.evidenceCount}</dd>
        </div>
        <div>
          <dt>Checked files</dt>
          <dd>{diagnostics.checkedFileCount}</dd>
        </div>
      </dl>
    </section>
  );
}

function RelatedRaces({ races }: { races: SourcePageModel["relatedRaces"] }) {
  return (
    <article className="route-card" aria-labelledby="source-related-races-title">
      <p className="eyebrow">Related races</p>
      <h2 id="source-related-races-title">Race pages</h2>
      <ul className="drilldown-link-list">
        {races.map((race) => (
          <li key={race.id}>
            <a href={`/races/${race.slug}/`}>{race.title}</a>
            <span>{race.jurisdiction} · {formatDate(race.electionDate)} · {race.positionCount} positions · {race.evidenceCount} evidence</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function RelatedEntities({ entities }: { entities: SourcePageModel["relatedEntities"] }) {
  return (
    <article className="route-card" aria-labelledby="source-related-entities-title">
      <p className="eyebrow">Related entities</p>
      <h2 id="source-related-entities-title">Candidates and measures</h2>
      <ul className="drilldown-link-list">
        {entities.map((entity) => (
          <li key={entity.id}>
            <a href={`/entities/${entity.slug}/`}>{entity.name}</a>
            <span>{entity.kind} · {entity.positionCount} positions · {entity.evidenceCount} evidence</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function PositionReceipts({ positions }: { positions: DrilldownPositionGroup[] }) {
  return (
    <section className="section-shell" aria-labelledby="source-receipts-title">
      <div className="section-heading">
        <p className="eyebrow">Receipts</p>
        <h2 id="source-receipts-title">Verified public recommendations</h2>
      </div>
      <div className="drilldown-receipt-list">
        {positions.map((group) => (
          <article
            className="route-card drilldown-receipt-card"
            key={`${group.race.id}:${group.position.id}`}
            data-recommendation-id={group.position.id}
            data-recommendation-review-status={group.position.reviewStatus}
            data-recommendation-publication-status={group.position.publicationStatus}
            data-recommendation-evidence-count={group.evidence.length}
          >
            <p className="eyebrow">{group.position.kind}</p>
            <h3>{group.position.label}</h3>
            <p className="muted-copy">
              <a href={`/races/${group.race.slug}/`}>{group.race.title}</a> · <a href={`/entities/${group.entity.slug}/`}>{group.entity.name}</a>
            </p>
            {group.position.rationale ? <p>{group.position.rationale}</p> : null}
            <EvidenceList positionId={group.position.id} evidence={group.evidence} />
          </article>
        ))}
      </div>
    </section>
  );
}

function EvidenceList({ positionId, evidence }: { positionId: string; evidence: DrilldownPositionGroup["evidence"] }) {
  return (
    <ul className="receipt-evidence-list">
      {evidence.map((item) => (
        <li
          className="receipt-evidence-card"
          key={item.id}
          data-drilldown-evidence-id={item.id}
          data-drilldown-evidence-position-id={positionId}
          data-drilldown-evidence-review-status={item.reviewStatus}
          data-drilldown-evidence-publication-status={item.publicationStatus}
          data-drilldown-evidence-source-url={item.url}
        >
          <blockquote>“{item.quote}”</blockquote>
          <dl>
            <div>
              <dt>Source URL</dt>
              <dd><a href={item.url}>{item.url}</a></dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{item.reviewStatus} / {item.publicationStatus}</dd>
            </div>
            <div>
              <dt>Evidence kind</dt>
              <dd>{item.kind}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function CheckedFiles({ files }: { files: string[] }) {
  return (
    <section className="route-card" aria-labelledby="source-checked-files-title">
      <p className="eyebrow">Checked files</p>
      <h2 id="source-checked-files-title">Public data inspected</h2>
      <details className="checked-files" open>
        <summary>{files.length} public data files</summary>
        <ul>
          {files.map((file) => (
            <li key={file}><code>{file}</code></li>
          ))}
        </ul>
      </details>
    </section>
  );
}

async function loadPublicRaceContexts(options: LoaderOptions = {}): Promise<LoadedPublicRaceContext[]> {
  const slugs = await listRaceSlugs(options);
  const contexts = await Promise.all(slugs.map((slug) => loadPublicRaceContext(slug, options)));
  return contexts.filter((context): context is LoadedPublicRaceContext => context !== null);
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
