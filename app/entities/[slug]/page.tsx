import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listRaceSlugs, loadPublicRaceContext, type LoadedPublicRaceContext, type LoaderOptions } from "../../../lib/data/loaders";
import { buildEntityShareMetadata } from "../../../lib/share/metadata";
import { buildEntityDrilldownModel, type DrilldownPositionGroup, type EntityDrilldownModel } from "../../../lib/ui/drilldowns";

export const dynamic = "force-static";

export interface EntityPageModel extends EntityDrilldownModel {
  checkedFiles: string[];
  diagnostics: EntityDrilldownModel["diagnostics"] & {
    checkedFileCount: number;
  };
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const contexts = await loadPublicRaceContexts();
  const slugs = new Set<string>();
  for (const context of contexts) {
    const publicEntityIds = new Set(context.race.positions.map((position) => position.entityId));
    for (const entity of context.entities) {
      if (publicEntityIds.has(entity.id)) slugs.add(entity.slug);
    }
  }
  return [...slugs].sort().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const model = await buildEntityPageModel(slug);
  return buildEntityShareMetadata(model, `/entities/${slug}/`);
}

export async function buildEntityPageModel(slug: string, options: LoaderOptions = {}): Promise<EntityPageModel | null> {
  const contexts = await loadPublicRaceContexts(options);
  const model = buildEntityDrilldownModel(contexts, slug);
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

export default async function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const model = await buildEntityPageModel(slug);

  if (!model) notFound();

  const { entity, counts, diagnostics, relatedRaces, relatedSources, positions } = model;
  if (!entity) notFound();

  return (
    <main
      className="race-page-shell drilldown-page-shell"
      data-drilldown-kind="entity"
      data-drilldown-slug={model.slug}
      data-related-race-count={diagnostics.relatedRaceCount}
      data-recommendation-count={diagnostics.publicPositionCount}
      data-evidence-count={diagnostics.evidenceCount}
      data-checked-file-count={diagnostics.checkedFileCount}
    >
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <span>Entities</span>
        <span aria-hidden="true">/</span>
        <span>{entity.name}</span>
      </nav>

      <section className="race-hero" aria-labelledby="entity-title">
        <div className="race-hero-copy">
          <p className="eyebrow">Entity drill-down</p>
          <h1 id="entity-title">{entity.name}</h1>
          <p className="lede">
            Public, verified recommendation receipts for this {entity.kind}, collected from published race pages only.
          </p>
          {entity.description ? <p className="muted-copy">{entity.description}</p> : null}
          {entity.officialUrl ? <a className="drilldown-primary-link" href={entity.officialUrl}>Official website</a> : null}
        </div>

        <aside className="consensus-panel" aria-labelledby="entity-counts-title">
          <p className="panel-kicker">Published recommendation trail</p>
          <h2 id="entity-counts-title">{counts.publicPositionCount} recommendations</h2>
          <dl className="race-meta" aria-label="Entity recommendation counts">
            <div>
              <dt>Related races</dt>
              <dd>{counts.relatedRaceCount}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>{counts.sourceCount}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>{counts.evidenceCount}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{entity.status}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="drilldown-grid" aria-label="Related public records">
        <RelatedRaces races={relatedRaces} />
        <RelatedSources sources={relatedSources} />
      </section>

      <PositionReceipts positions={positions} />
    </main>
  );
}

function RelatedRaces({ races }: { races: EntityPageModel["relatedRaces"] }) {
  return (
    <article className="route-card" aria-labelledby="entity-related-races-title">
      <p className="eyebrow">Related races</p>
      <h2 id="entity-related-races-title">Race pages</h2>
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

function RelatedSources({ sources }: { sources: EntityPageModel["relatedSources"] }) {
  return (
    <article className="route-card" aria-labelledby="entity-related-sources-title">
      <p className="eyebrow">Related sources</p>
      <h2 id="entity-related-sources-title">Published source trail</h2>
      <ul className="drilldown-link-list">
        {sources.map((source) => (
          <li key={source.id}>
            <a href={`/sources/${source.slug}/`}>{source.name}</a>
            <span>{source.sourceType} · {source.positionCount} positions · {source.evidenceCount} evidence</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function PositionReceipts({ positions }: { positions: DrilldownPositionGroup[] }) {
  return (
    <section className="section-shell" aria-labelledby="entity-receipts-title">
      <div className="section-heading">
        <p className="eyebrow">Receipts</p>
        <h2 id="entity-receipts-title">Verified public recommendations</h2>
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
              <a href={`/races/${group.race.slug}/`}>{group.race.title}</a> · <a href={`/sources/${group.source.slug}/`}>{group.source.name}</a>
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
