import { notFound } from "next/navigation";
import { listRaceSlugs, loadPublicRaceContext, type LoadedPublicRaceContext, type LoaderOptions } from "../../../lib/data/loaders";
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
      hasManualOverride: context.checkedFiles.some((file) => file.includes("manual/overrides/races/")),
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

  const { ui, matrix, receipts, reviewedSummary, diagnostics, checkedFiles } = model;
  const consensusLabel = ui.consensus.entityName ? ui.consensus.label : ui.consensus.label;

  return (
    <main className="race-page-shell">
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
            recommendation matrix, and explicit placeholders for receipts, AI disclosure, and drill-down pages.
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
            <div>
              <dt>Review status</dt>
              <dd>{diagnostics.reviewStatus}</dd>
            </div>
            <div>
              <dt>Publication</dt>
              <dd>{diagnostics.publicationStatus}</dd>
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

      <section className="route-diagnostics" aria-labelledby="diagnostics-title">
        <div className="section-heading">
          <p className="eyebrow">Visible diagnostics</p>
          <h2 id="diagnostics-title">What reached the static route</h2>
        </div>
        <dl className="metric-grid">
          <div>
            <dt>Positions</dt>
            <dd>{diagnostics.publicPositionCount}</dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>{diagnostics.publicSourceCount}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{diagnostics.evidenceCount}</dd>
          </div>
          <div>
            <dt>Checked files</dt>
            <dd>{diagnostics.checkedFileCount}</dd>
          </div>
          <div>
            <dt>Matrix cells</dt>
            <dd>{diagnostics.matrixCellCount}</dd>
          </div>
        </dl>
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

      <ReviewedSummary summary={reviewedSummary} />

      <section className="placeholder-grid" aria-label="Deferred public modules">
        <PlaceholderCard
          title="Entity pages"
          ready={ui.placeholders.drilldownReady}
          body="Candidate drill-down paths will use trailing-slash routes such as /entities/candidate-slug/ once entity pages ship."
        />
        <PlaceholderCard
          title="Entity pages"
          ready={ui.placeholders.drilldownReady}
          body="Candidate drill-down paths will use trailing-slash routes such as /entities/candidate-slug/ once entity pages ship."
        />
        <PlaceholderCard
          title="Source pages"
          ready={ui.placeholders.drilldownReady}
          body="Source drill-down paths will use trailing-slash routes such as /sources/source-slug/ once source pages ship."
        />
      </section>

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
        <details className="checked-files">
          <summary>Checked public data files</summary>
          <ul>
            {checkedFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  );
}

function CandidateCard({ candidate }: { candidate: RaceEntityCard }) {
  return (
    <article className="candidate-card">
      <div>
        <p className="eyebrow">{candidate.kind}</p>
        <h3>{candidate.name}</h3>
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
        <strong>{source.name}</strong>
        <span>
          {source.sourceType} · {source.positionCount} positions · {source.evidenceCount} evidence
        </span>
      </div>
      {href ? <a href={href}>Visit source</a> : <span>No public URL</span>}
    </li>
  );
}

function PlaceholderCard({ title, ready, body }: { title: string; ready: boolean; body: string }) {
  return (
    <article className="placeholder-module" aria-labelledby={`${slugify(title)}-title`}>
      <p className={ready ? "status-pill ready" : "status-pill pending"}>{ready ? "Data ready" : "Waiting for data"}</p>
      <h2 id={`${slugify(title)}-title`}>{title}</h2>
      <p>{body}</p>
    </article>
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

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
