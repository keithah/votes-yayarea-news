import type { Metadata } from "next";
import Link from "next/link";
import { buildHomeShareMetadata } from "../lib/share/metadata";
import { loadHomePageModel, type HomePageModel, type HomeRaceModel, type HomeRaceSectionId } from "../lib/ui/home";

export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const model = await loadHomePageModel();
  return buildHomeShareMetadata({
    raceCount: model.totals.raceCount,
    sourceCount: model.totals.publicSourceCount,
    evidenceCount: model.totals.evidenceCount,
  });
}

export default async function Home() {
  const model = await loadHomePageModel();
  const { races, sections, totals } = model;

  const consensusSourceCount = races.reduce((count, race) => count + race.consensusSourceCount, 0);

  return (
    <main
      className="home-shell"
      data-public-source-count={totals.publicSourceCount}
      data-reviewed-position-source-count={totals.reviewedPositionSourceCount}
      data-consensus-source-count={consensusSourceCount}
    >
      <section className="hero hero-grid" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">June 2, 2026 · San Francisco primary</p>
          <h1 id="page-title">A public trail for 2026 California and San Francisco election records.</h1>
          <p className="lede">
            votes.yayarea.news turns official candidate lists, voter guides, editorial endorsements, and civic
            source material into static race pages with visible counts, provenance, comparison
            tools, evidence receipts, and AI-use disclosure.
          </p>
          <div className="hero-actions" aria-label="Homepage actions">
            <a className="button button-primary" href="#public-races">
              Browse public races
            </a>
            <a className="button button-secondary" href="#methodology">
              How this works
            </a>
          </div>
        </div>

        <aside className="hero-panel" aria-label="Public data snapshot">
          <p className="panel-kicker">Static snapshot</p>
          <dl className="metric-grid">
            <div>
              <dt>Public races</dt>
              <dd>{totals.raceCount}</dd>
            </div>
            <div>
              <dt>Public sources</dt>
              <dd>{totals.publicSourceCount}</dd>
            </div>
            <div>
              <dt>Evidence items</dt>
              <dd>{totals.evidenceCount}</dd>
            </div>
            <div>
              <dt>Candidates</dt>
              <dd>{totals.candidateCount}</dd>
            </div>
          </dl>
          <p className="panel-note">
            Counts come from the same public race view model used by race pages, so source-coverage
            drift is visible at build time instead of hidden behind client state.
          </p>
        </aside>
      </section>

      <section className="section-shell" id="public-races" aria-labelledby="public-races-title">
        <div className="section-heading">
          <p className="eyebrow">Public race discovery</p>
          <h2 id="public-races-title">Races ready for public review</h2>
          <p>
            Start with the race shell, then follow source counts and readiness markers to see what has
            been reviewed and which public launch gates are active.
          </p>
        </div>

        <HomeRaceSections sections={sections} />
      </section>

      <section className="trust-grid" id="methodology" aria-label="Methodology and trust modules">
        <article className="trust-card">
          <p className="eyebrow">Methodology</p>
          <h2>Public records only</h2>
          <p>
            Homepage cards are generated from `loadPublicRaceContext`, which filters races,
            positions, summaries, and themes to records marked public after review.
          </p>
        </article>
        <article className="trust-card">
          <p className="eyebrow">Reviewed-source trust</p>
          <h2>Counts before claims</h2>
          <p>
            Every card surfaces public source, evidence, and candidate or option counts so readers can distinguish a
            sparse public record from a rendering bug or missing publication step.
          </p>
        </article>
        <article className="trust-card launch-card">
          <p className="eyebrow">Launch QA</p>
          <h2>Share, analytics, receipts, and disclosure gates</h2>
          <p>
            Static verification now checks share-card metadata, anonymous analytics markers,
            evidence receipts, source/entity drill-downs, AI disclosure, and public trust leaks
            before launch claims.
          </p>
        </article>
      </section>
    </main>
  );
}

export function HomeRaceSections({ sections }: { sections: HomePageModel["sections"] }) {
  return (
    <div className="home-section-stack">
      {sections.map((section) => (
        <section
          key={section.id}
          className="home-race-section"
          aria-labelledby={`home-section-${section.id}-title`}
          data-home-section={section.id}
          data-home-section-order={section.diagnostics.order}
          data-home-section-race-count={section.races.length}
          data-public-source-count={section.diagnostics.publicSourceCount}
          data-reviewed-position-source-count={section.diagnostics.reviewedPositionSourceCount}
          data-consensus-source-count={section.diagnostics.consensusSourceCount}
          data-consensus-support-count={section.diagnostics.consensusSupportCount}
          data-source-status-label-counts={JSON.stringify(section.diagnostics.sourceStatusLabelCounts)}
        >
          <div className="home-race-section-heading">
            <p className="eyebrow">{section.id === "statewide-broader" ? "Statewide / broader" : "Local"}</p>
            <h3 id={`home-section-${section.id}-title`}>{getHomeSectionHeading(section.id)}</h3>
            <p>{section.deck}</p>
          </div>

          {section.races.length > 0 ? (
            <div className="race-grid">
              {section.races.map((race) => (
                <RaceCard key={race.race.id} race={race} sectionId={section.id} />
              ))}
            </div>
          ) : (
            <div className="empty-state" role="status">
              <p className="empty-title">No {getHomeSectionHeading(section.id).toLowerCase()} are published in this section yet.</p>
              <p>
                The static loader succeeded, but every race for this discovery section is currently hidden by review or publication gates.
                Publish a verified race to replace this state with public cards.
              </p>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function RaceCard({ race, sectionId }: { race: HomeRaceModel; sectionId: HomeRaceSectionId }) {
  const href = `/races/${race.race.slug}/`;
  const consensus = race.consensus.entityName ? race.consensus.label : "No public consensus yet";

  return (
    <article
      className="race-card"
      data-home-section-id={sectionId}
      data-race-slug={race.diagnostics.raceSlug}
      data-public-source-count={race.diagnostics.publicSourceCount}
      data-reviewed-position-source-count={race.diagnostics.reviewedPositionSourceCount}
      data-consensus-source-count={race.diagnostics.consensusSourceCount}
      data-consensus-support-count={race.diagnostics.consensusSupportCount}
    >
      <div className="race-card-topline">
        <span>{formatDate(race.race.electionDate)}</span>
        <span>{race.race.jurisdiction}</span>
      </div>
      <h3>
        <Link href={href}>{race.race.title}</Link>
      </h3>
      <p className="race-consensus">{consensus}</p>
      <dl className="race-stats" aria-label={`${race.race.title} public counts`}>
        <div>
          <dt>Public sources</dt>
          <dd>{race.publicSourceCount}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{race.evidenceCount}</dd>
        </div>
        <div>
          <dt>Candidates</dt>
          <dd>{race.candidateCount}</dd>
        </div>
      </dl>
      <div className="source-label-list" aria-label={`${race.race.title} source labels`}>
        <span>{race.countLabels.publicSources}</span>
        <span>{race.countLabels.reviewedPositionSources}</span>
        <span>
          {formatCountLabel(race.consensusSupportCount, "consensus support")} from {race.countLabels.consensusSources}
        </span>
      </div>
      <ul className="source-status-list" aria-label={`${race.race.title} source status labels`}>
        {race.sourceStatusLabels.length > 0 ? (
          race.sourceStatusLabels.map((sourceStatus) => (
            <li
              key={sourceStatus.status}
              className={getSourceStatusClassName(sourceStatus.status)}
              data-source-status={sourceStatus.status}
              data-source-status-count={sourceStatus.count}
            >
              {sourceStatus.count} {sourceStatus.label}
            </li>
          ))
        ) : (
          <li className="source-status-muted">No source-status labels published</li>
        )}
      </ul>
      <div className="source-type-list" aria-label="Source type breakdown">
        {race.sourceTypeBreakdown.length > 0 ? (
          race.sourceTypeBreakdown.map((sourceType) => (
            <span key={sourceType.sourceType}>
              {sourceType.sourceCount} {sourceType.sourceType}
            </span>
          ))
        ) : (
          <span>No public source types yet</span>
        )}
      </div>
      <ul className="readiness-list" aria-label="Race module readiness">
        <li className={race.placeholders.matrixReady ? "ready" : "pending"}>Matrix ready</li>
        <li className={race.placeholders.receiptsReady ? "ready" : "pending"}>Receipts ready</li>
        <li className={race.placeholders.aiDisclosureReady ? "ready" : "pending"}>AI disclosure ready</li>
      </ul>
      <Link className="card-link" href={href} aria-label={`Open ${race.race.title}`}>
        Open race shell
        <span aria-hidden="true"> →</span>
      </Link>
    </article>
  );
}

function getHomeSectionHeading(sectionId: HomeRaceSectionId): string {
  return sectionId === "statewide-broader" ? "Statewide and broader races" : "Local races";
}

function formatCountLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function getSourceStatusClassName(status: string): string {
  return status === "reviewed-public-position" ? "source-status-positive" : "source-status-context";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
