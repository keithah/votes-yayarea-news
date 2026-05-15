"use client";

import { ANALYTICS_EVENTS, trackAnalyticsEvent } from "../../../lib/analytics/events";
import type { ReviewedSummaryEvidenceModel } from "../../../lib/ui/race";

interface ReviewedSummaryProps {
  summary: ReviewedSummaryEvidenceModel;
  raceSlug: string;
}

export function ReviewedSummary({ summary, raceSlug }: ReviewedSummaryProps) {
  const available = summary.visible && summary.status === "available";

  return (
    <section
      className="route-card reviewed-summary"
      aria-labelledby="summary-title"
      data-summary-visible={String(summary.visible)}
      data-summary-status={summary.status}
      data-summary-id={summary.summaryId ?? "none"}
      data-summary-evidence-count={summary.evidenceCount}
    >
      <p className="eyebrow">Reviewed AI summary</p>
      <h2 id="summary-title">Disclosure-ready summary module</h2>

      {available ? (
        <details
          className="reviewed-summary-details"
          data-summary-expanded="native-details"
          data-analytics-event={ANALYTICS_EVENTS.aiSummaryExpand}
          onToggle={(event) => {
            if (!event.currentTarget.open) return;
            trackAnalyticsEvent(ANALYTICS_EVENTS.aiSummaryExpand, {
              routeKind: "race",
              raceSlug,
            });
          }}
        >
          <summary>
            <span>Read reviewed summary and public evidence</span>
            <small>{summary.evidenceCount} public evidence references</small>
          </summary>
          <div className="reviewed-summary-body">
            <p>{summary.text}</p>
            <p className="muted-copy">
              AI assistance may help summarize the reviewed public record, but this module only publishes after human review and links back to public supporting evidence.
            </p>
            <ul className="summary-evidence-list" aria-label="Summary supporting evidence">
              {summary.evidence.map((evidence) => (
                <li
                  key={evidence.id}
                  data-summary-evidence-id={evidence.id}
                  data-summary-source-id={evidence.source.id}
                  data-summary-candidate-id={evidence.candidate?.id ?? "race-level"}
                  data-summary-review-status={evidence.reviewStatus}
                  data-summary-publication-status={evidence.publicationStatus}
                >
                  <blockquote>“{evidence.quote}”</blockquote>
                  <p>
                    <strong>{evidence.source.label}</strong>
                    {evidence.candidate ? ` · ${evidence.candidate.label}` : ""} · {evidence.position.label}
                  </p>
                  <a href={evidence.url}>Open supporting source</a>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : (
        <div className="reviewed-summary-empty" data-summary-empty-reason={summary.emptyReason ?? "unknown"}>
          <p className="muted-copy">
            {summary.emptyReason === "no-public-evidence"
              ? "A reviewed public summary exists, but its supporting evidence is not available in the public model, so the summary is withheld."
              : "No reviewed public AI-assisted summary is published for this race yet."}
          </p>
        </div>
      )}
    </section>
  );
}
