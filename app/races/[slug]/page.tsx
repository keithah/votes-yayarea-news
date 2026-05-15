import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listRaceSlugs, loadPublicRaceContext, type LoadedPublicRaceContext, type LoaderOptions } from "../../../lib/data/loaders";
import { buildRaceShareMetadata } from "../../../lib/share/metadata";
import {
  buildRaceReceiptsModel,
  buildRaceReviewedSummaryModel,
  buildRaceUiModel,
  buildRecommendationMatrixModel,
  type RaceEntityCard,
  type RaceReceiptCollectionModel,
  type RaceSourceCard,
  type RaceUiModel,
  type RecommendationMatrixModel,
  type ReviewedSummaryEvidenceModel,
} from "../../../lib/ui/race";
import { RecommendationMatrix } from "./recommendation-matrix";
import { ReviewedSummary } from "./reviewed-summary";

export const dynamic = "force-static";

export interface RacePageModel {
  ui: RaceUiModel;
  matrix: RecommendationMatrixModel;
  receipts: RaceReceiptCollectionModel;
  reviewedSummary: ReviewedSummaryEvidenceModel;
  checkedFiles: string[];
  diagnostics: {
    reviewStatus: string;
    publicationStatus: string;
    hasManualOverride: boolean;
    publicPositionCount: number;
    publicSourceCount: number;
    evidenceCount: number;
    checkedFileCount: number;
    matrixCandidateCount: number;
    matrixSourceCount: number;
    matrixCellCount: number;
    receiptCount: number;
    availableReceiptCount: number;
    reviewedSummaryEvidenceCount: number;
  };
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await listRaceSlugs();
  const publicContexts = await Promise.all(slugs.map((slug) => loadPublicRaceContext(slug)));
  return publicContexts
    .filter((context): context is LoadedPublicRaceContext => context !== null)
    .map((context) => ({ slug: context.race.slug }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const model = await buildRacePageModel(slug);
  return buildRaceShareMetadata(model?.ui, `/races/${slug}/`);
}

export async function buildRacePageModel(slug: string, options: LoaderOptions = {}): Promise<RacePageModel | null> {
  const context = await loadPublicRaceContext(slug, options);
  if (!context) return null;

  const ui = buildRaceUiModel(context);
  const matrix = buildRecommendationMatrixModel(ui);
  const receipts = buildRaceReceiptsModel(ui, matrix);
  const reviewedSummary = buildRaceReviewedSummaryModel(ui);
  return {
    ui,
    matrix,
    receipts,
    reviewedSummary,
    checkedFiles: context.checkedFiles,
    diagnostics: {
      reviewStatus: context.race.status,
      publicationStatus: context.race.publicationStatus,
      hasManualOverride: context.checkedFiles.some((file) => file.includes(["manual", "overrides", "races"].join("/"))),
      publicPositionCount: ui.positions.length,
      publicSourceCount: ui.sourceCount,
      evidenceCount: ui.evidenceCount,
      checkedFileCount: context.checkedFiles.length,
      matrixCandidateCount: matrix.candidates.length,
      matrixSourceCount: matrix.sources.length,
      matrixCellCount: Object.keys(matrix.cells).length,
      receiptCount: receipts.receiptCount,
      availableReceiptCount: receipts.availableCount,
      reviewedSummaryEvidenceCount: reviewedSummary.evidenceCount,
    },
  };
}

export default async function RacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const model = await buildRacePageModel(slug);

  if (!model) notFound();

  const { ui, matrix, receipts, reviewedSummary } = model;
  const consensusLabel = ui.consensus.entityName ? ui.consensus.label : ui.consensus.label;

  return (
    <main className="race-page-shell" data-analytics-event="race_page_view" data-analytics-route-kind="race" data-analytics-race-slug={ui.race.slug}>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <span>{ui.race.title}</span>
      </nav>

      <section className="race-hero" aria-labelledby="race-title">
        <div className="race-hero-copy">
          <p className="eyebrow">Public race shell</p>
          <h1 id="race-title">{ui.race.title}</h1>
          <p className="lede">
            Reviewed public positions for {ui.race.jurisdiction}, with source counts, a source-by-candidate
            recommendation matrix, evidence receipts, reviewed AI summary support, and disclosure links.
          </p>
          <dl className="race-meta" aria-label="Race metadata">
            <div>
              <dt>Election date</dt>
              <dd>{formatDate(ui.race.electionDate)}</dd>
            </div>
            <div>
              <dt>Jurisdiction</dt>
              <dd>{ui.race.jurisdiction}</dd>
            </div>
          </dl>
        </div>

        <aside className="consensus-panel" aria-labelledby="consensus-title">
          <p className="panel-kicker">Consensus snapshot</p>
          <h2 id="consensus-title">{consensusLabel}</h2>
          <div
            className="consensus-meter"
            aria-label={`Consensus meter: ${ui.consensus.percentage} percent`}
            role="img"
          >
            <span style={{ inlineSize: `${ui.consensus.percentage}%` }} />
          </div>
          <p className="panel-note">
            {ui.consensus.count} of {ui.consensus.sourceCount} public sources count toward this
            snapshot. Empty races intentionally show zeroed copy instead of inferred support.
          </p>
        </aside>
      </section>

      <section className="section-shell" aria-labelledby="candidates-title">
        <div className="section-heading">
          <p className="eyebrow">Candidate snapshot</p>
          <h2 id="candidates-title">Public candidate cards</h2>
          <p>Counts are grouped by candidate so sparse public records are visible alongside the recommendation matrix.</p>
        </div>
        <div className="candidate-grid">
          {ui.candidates.map((candidate) => (
            <CandidateCard key={candidate.id} candidate={candidate} />
          ))}
        </div>
      </section>

      <RecommendationMatrix matrix={matrix} receipts={receipts} />

      <section className="breakdown-grid" aria-label="Source type and source list">
        <article className="route-card" aria-labelledby="source-types-title">
          <p className="eyebrow">Source types</p>
          <h2 id="source-types-title">Breakdown</h2>
          {ui.sourceTypeBreakdown.length > 0 ? (
            <dl className="breakdown-list">
              {ui.sourceTypeBreakdown.map((item) => (
                <div key={item.sourceType}>
                  <dt>{item.sourceType}</dt>
                  <dd>
                    {item.sourceCount} sources · {item.positionCount} positions · {item.evidenceCount} evidence
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted-copy">No public source types are available yet.</p>
          )}
        </article>

        <article className="route-card" aria-labelledby="sources-title">
          <p className="eyebrow">Source list</p>
          <h2 id="sources-title">Reviewed source trail</h2>
          <ul className="source-list">
            {ui.sources.map((source) => (
              <SourceItem key={source.id} source={source} />
            ))}
          </ul>
        </article>
      </section>

      <ReviewedSummary summary={reviewedSummary} raceSlug={ui.race.slug} />

      <section className="route-card" aria-labelledby="themes-title">
        <p className="eyebrow">Themes and provenance</p>
        <h2 id="themes-title">Evidence-backed signals</h2>
        {ui.themes.length > 0 ? (
          <ul className="theme-list">
            {ui.themes.map((theme) => (
              <li key={theme.id}>
                <strong>{theme.label}</strong>
                <span>{theme.sentiment}</span>
                <span>{theme.evidenceCount} evidence references</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-copy">No public themes are published yet.</p>
        )}
      </section>
    </main>
  );
}

function CandidateCard({ candidate }: { candidate: RaceEntityCard }) {
  return (
    <article className="candidate-card">
      <div>
        <p className="eyebrow">{candidate.kind}</p>
        <h3>{candidate.positionCount > 0 ? <a href={`/entities/${candidate.slug}/`}>{candidate.name}</a> : candidate.name}</h3>
        {candidate.description ? <p className="muted-copy">{candidate.description}</p> : null}
      </div>
      <dl className="candidate-counts" aria-label={`${candidate.name} public position counts`}>
        <div>
          <dt>Endorse</dt>
          <dd>{candidate.countsByKind.endorse}</dd>
        </div>
        <div>
          <dt>Oppose</dt>
          <dd>{candidate.countsByKind.oppose}</dd>
        </div>
        <div>
          <dt>Info</dt>
          <dd>{candidate.countsByKind.informational}</dd>
        </div>
      </dl>
      <p className="module-count">
        {candidate.positionCount} positions · {candidate.sourceCount} sources · {candidate.evidenceCount} evidence
      </p>
    </article>
  );
}

function SourceItem({ source }: { source: RaceSourceCard }) {
  const href = source.guideUrl ?? source.homepageUrl;

  return (
    <li>
      <div>
        <strong><a href={`/sources/${source.slug}/`}>{source.name}</a></strong>
        <span>
          {source.sourceType} · {source.positionCount} positions · {source.evidenceCount} evidence
        </span>
      </div>
      <div className="source-actions">
        <a href={`/sources/${source.slug}/`}>Source page</a>
        {href ? <a href={href}>Visit source</a> : <span>No public URL</span>}
      </div>
    </li>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
