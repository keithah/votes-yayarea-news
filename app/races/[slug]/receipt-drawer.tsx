"use client";

import type { RaceReceiptModel, PublicReceiptEvidence } from "../../../lib/ui/race";

interface ReceiptDrawerProps {
  receipt?: RaceReceiptModel;
  onClose: () => void;
}

export function ReceiptDrawer({ receipt, onClose }: ReceiptDrawerProps) {
  if (!receipt) return null;

  const titleId = "receipt-drawer-title";
  const descriptionId = "receipt-drawer-description";
  const isAvailable = receipt.status === "available";

  return (
    <div className="receipt-drawer-backdrop" data-receipt-selected-cell-id={receipt.cellId} onClick={onClose}>
      <aside
        className="receipt-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-receipt-cell-id={receipt.cellId}
        data-receipt-cell-key={receipt.cellKey}
        data-receipt-status={receipt.status}
        data-receipt-evidence-count={receipt.evidenceCount}
        data-analytics-event="receipt_drawer_open"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="receipt-drawer-header">
          <div>
            <p className="eyebrow">Evidence receipt</p>
            <h2 id={titleId}>{receipt.candidate.label}</h2>
            <p id={descriptionId} className="muted-copy">
              {receipt.source.label} · {receipt.position.label}
            </p>
          </div>
          <button className="receipt-close-button" type="button" onClick={onClose} aria-label="Close evidence receipt">
            ×
          </button>
        </div>

        <dl className="receipt-facts" aria-label="Receipt metadata">
          <div>
            <dt>Cell id</dt>
            <dd>{receipt.cellId}</dd>
          </div>
          <div>
            <dt>Candidate</dt>
            <dd>{receipt.candidate.label}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{receipt.source.label}</dd>
          </div>
          <div>
            <dt>Position</dt>
            <dd>{receipt.position.label}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{receipt.status}</dd>
          </div>
          <div>
            <dt>Evidence ids</dt>
            <dd>{receipt.evidenceIds.length > 0 ? receipt.evidenceIds.join(", ") : "None"}</dd>
          </div>
        </dl>

        {isAvailable ? (
          <ul className="receipt-evidence-list" aria-label="Public evidence quotes">
            {receipt.evidence.map((evidence) => (
              <ReceiptEvidenceItem key={evidence.id} evidence={evidence} />
            ))}
          </ul>
        ) : (
          <p className="receipt-empty-state" data-receipt-empty-reason={receipt.emptyReason}>
            {receipt.emptyReason === "no-public-position"
              ? "No public position is published for this source and candidate, so no receipt is opened."
              : "This public position does not have a public evidence quote available yet."}
          </p>
        )}
      </aside>
    </div>
  );
}

function ReceiptEvidenceItem({ evidence }: { evidence: PublicReceiptEvidence }) {
  return (
    <li
      className="receipt-evidence-card"
      data-receipt-evidence-id={evidence.id}
      data-receipt-source-id={evidence.source.id}
      data-receipt-candidate-id={evidence.candidate?.id ?? "race-level"}
      data-receipt-review-status={evidence.reviewStatus}
      data-receipt-publication-status={evidence.publicationStatus}
    >
      <blockquote>“{evidence.quote}”</blockquote>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{evidence.source.label}</dd>
        </div>
        <div>
          <dt>Candidate</dt>
          <dd>{evidence.candidate?.label ?? "Race-level evidence"}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>{evidence.position.label}</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{evidence.reviewStatus}</dd>
        </div>
        <div>
          <dt>Publication</dt>
          <dd>{evidence.publicationStatus}</dd>
        </div>
      </dl>
      <a href={evidence.url}>Open source link</a>
    </li>
  );
}
