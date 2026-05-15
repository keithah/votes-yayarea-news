import type { Metadata } from "next";
import Link from "next/link";
import { listRaceSlugs, loadPublicRaceContext } from "../lib/data/loaders";
import { buildHomeShareMetadata } from "../lib/share/metadata";
import { buildRaceUiModel, type RaceUiModel } from "../lib/ui/race";

export const dynamic = "force-static";

export async function generateMetadata(): Promise<Metadata> {
  const races = await loadPublicRaceModels();
  const totals = summarizeRaces(races);
  return buildHomeShareMetadata(totals);
}

export default async function Home() {
  const races = await loadPublicRaceModels();
  const totals = summarizeRaces(races);

  return (
    <main className="home-shell">
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
              <dt>Reviewed sources</dt>
              <dd>{totals.sourceCount}</dd>
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
            Counts come from the same public race view model used by race pages, so publication
            gating failures are visible at build time instead of hidden behind client state.
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

        {races.length > 0 ? (
          <div className="race-grid">
            {races.map((race) => (
              <RaceCard key={race.race.id} race={race} />
            ))}
          </div>
        ) : (
          <div className="empty-state" role="status">
            <p className="empty-title">No public races are published yet.</p>
            <p>
              The static loader succeeded, but every race is currently hidden by review or
              publication gates. Publish a verified race to replace this state with public cards.
            </p>
          </div>
        )}
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
            Every card surfaces source, evidence, and candidate or option counts so readers can distinguish a
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

function RaceCard({ race }: { race: RaceUiModel }) {
  const href = `/races/${race.race.slug}/`;
  const consensus = race.consensus.entityName ? race.consensus.label : "No public consensus yet";

  return (
    <article className="race-card">
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
          <dt>Sources</dt>
          <dd>{race.sourceCount}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{race.evidenceCount}</dd>
        </div>
        <div>
          <dt>Candidates</dt>
          <dd>{race.candidates.length}</dd>
        </div>
      </dl>
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

async function loadPublicRaceModels(): Promise<RaceUiModel[]> {
  const slugs = await listRaceSlugs();
  const contexts = await Promise.all(slugs.map((slug) => loadPublicRaceContext(slug)));
  return contexts
    .filter((context): context is NonNullable<typeof context> => context !== null)
    .map((context) => buildRaceUiModel(context))
    .sort((left, right) => left.race.title.localeCompare(right.race.title));
}

function summarizeRaces(races: RaceUiModel[]) {
  return {
    raceCount: races.length,
    sourceCount: races.reduce((count, race) => count + race.sourceCount, 0),
    evidenceCount: races.reduce((count, race) => count + race.evidenceCount, 0),
    candidateCount: races.reduce((count, race) => count + race.candidates.length, 0),
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
