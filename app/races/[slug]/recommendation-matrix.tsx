"use client";

import { useMemo, useState } from "react";
import type {
  RaceReceiptCollectionModel,
  RaceReceiptModel,
  RecommendationMatrixCell,
  RecommendationMatrixFilterPositionKind,
  RecommendationMatrixModel,
  RecommendationMatrixSource,
} from "../../../lib/ui/race";
import { ReceiptDrawer } from "./receipt-drawer";

interface RecommendationMatrixProps {
  matrix: RecommendationMatrixModel;
  receipts: RaceReceiptCollectionModel;
}

type SourceTypeFilter = "all" | string;
type CandidateFilter = "all" | string;
type PositionKindFilter = "all" | RecommendationMatrixFilterPositionKind;
type SortOrder = "source-type-then-name" | "source-name" | "most-evidence";
type GroupingMode = "sourceType" | "none";

const ALL = "all" as const;

export function RecommendationMatrix({ matrix, receipts }: RecommendationMatrixProps) {
  const [sourceType, setSourceType] = useState<SourceTypeFilter>(ALL);
  const [candidateId, setCandidateId] = useState<CandidateFilter>(ALL);
  const [positionKind, setPositionKind] = useState<PositionKindFilter>(ALL);
  const [sortOrder, setSortOrder] = useState<SortOrder>(matrix.defaultSort.key);
  const [grouping, setGrouping] = useState<GroupingMode>(matrix.defaultGrouping.key);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);

  const view = useMemo(
    () => buildMatrixView(matrix, { sourceType, candidateId, positionKind, sortOrder, grouping }),
    [matrix, sourceType, candidateId, positionKind, sortOrder, grouping],
  );

  const selectedReceipt = selectedCellId ? receipts.byCellId[selectedCellId] : undefined;

  if (matrix.empty) {
    return (
      <section className="recommendation-matrix-shell route-card" aria-labelledby="recommendation-matrix-title" data-matrix-empty="true">
        <p className="eyebrow">Recommendation matrix</p>
        <h2 id="recommendation-matrix-title">Source-by-candidate comparison</h2>
        <p className="muted-copy">No public source and candidate pairs are available for this race yet.</p>
      </section>
    );
  }

  return (
    <section
      className="recommendation-matrix-shell"
      aria-labelledby="recommendation-matrix-title"
      data-race-slug={matrix.raceSlug}
      data-matrix-candidate-count={matrix.candidates.length}
      data-matrix-source-count={matrix.sources.length}
      data-matrix-cell-count={Object.keys(matrix.cells).length}
      data-receipt-count={receipts.receiptCount}
      data-receipt-available-count={receipts.availableCount}
      data-selected-cell-id={selectedCellId ?? "none"}
    >
      <div className="section-heading">
        <p className="eyebrow">Recommendation matrix</p>
        <h2 id="recommendation-matrix-title">Source-by-candidate comparison</h2>
        <p>
          Compare published recommendations across {matrix.sources.length} sources and {matrix.candidates.length} candidates.
          Controls only change presentation; the complete default matrix is rendered in the static page HTML.
        </p>
      </div>

      <form className="matrix-controls" aria-label="Recommendation matrix presentation controls">
        <label>
          <span>Source type</span>
          <select value={sourceType} onChange={(event) => setSourceType(event.currentTarget.value)}>
            <option value={ALL}>All source types</option>
            {matrix.filters.sourceTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.sourceCount})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Candidate focus</span>
          <select value={candidateId} onChange={(event) => setCandidateId(event.currentTarget.value)}>
            <option value={ALL}>All candidates</option>
            {matrix.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Position focus</span>
          <select value={positionKind} onChange={(event) => setPositionKind(event.currentTarget.value as PositionKindFilter)}>
            <option value={ALL}>All positions</option>
            {matrix.filters.positionKinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.cellCount})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Sort rows</span>
          <select value={sortOrder} onChange={(event) => setSortOrder(normalizeSortOrder(event.currentTarget.value))}>
            <option value="source-type-then-name">Source type, then name</option>
            <option value="source-name">Source name</option>
            <option value="most-evidence">Most evidence</option>
          </select>
        </label>

        <label>
          <span>Grouping</span>
          <select value={grouping} onChange={(event) => setGrouping(normalizeGrouping(event.currentTarget.value))}>
            <option value="sourceType">Group by source type</option>
            <option value="none">Flat source list</option>
          </select>
        </label>
      </form>

      <div className="matrix-desktop" data-matrix-view="desktop">
        <table className="recommendation-table">
          <caption>
            Public recommendation matrix grouped by {grouping === "sourceType" ? "source type" : "source"}; {view.sources.length} visible sources, {view.candidates.length} visible candidates.
          </caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              {view.candidates.map((candidate) => (
                <th key={candidate.id} id={`matrix-col-${safeDomId(candidate.id)}`} scope="col" data-candidate-id={candidate.id}>
                  <span>{candidate.name}</span>
                  <small>{candidate.positionCount} positions · {candidate.evidenceCount} evidence</small>
                </th>
              ))}
            </tr>
          </thead>
          {view.groups.map((group) => (
            <tbody key={group.id} data-source-type={group.sourceType}>
              {grouping === "sourceType" ? (
                <tr className="matrix-group-row">
                  <th scope="rowgroup" colSpan={view.candidates.length + 1}>
                    {group.label} <span>{group.sourceCount} sources · {group.evidenceCount} evidence</span>
                  </th>
                </tr>
              ) : null}
              {group.sources.map((source) => (
                <tr key={source.id} data-source-id={source.id}>
                  <th scope="row" id={`matrix-row-${safeDomId(source.id)}`}>
                    <span>{source.name}</span>
                    <small>{source.sourceType} · {source.evidenceCount} evidence</small>
                  </th>
                  {view.candidates.map((candidate) => {
                    const cell = matrix.cells[cellKey(source.id, candidate.id)];
                    return (
                      <MatrixTableCell
                        key={cell.id}
                        cell={cell}
                        receipt={receipts.byCellId[cell.id]}
                        sourceName={source.name}
                        candidateName={candidate.name}
                        onSelect={setSelectedCellId}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="matrix-mobile" data-matrix-view="mobile" aria-label="Mobile recommendation cards">
        {view.candidates.map((candidate) => (
          <article key={candidate.id} className="matrix-candidate-card" aria-labelledby={`matrix-mobile-${safeDomId(candidate.id)}`} data-candidate-id={candidate.id}>
            <h3 id={`matrix-mobile-${safeDomId(candidate.id)}`}>{candidate.name}</h3>
            <p className="module-count">{candidate.positionCount} positions · {candidate.evidenceCount} evidence</p>
            <div className="matrix-source-stack">
              {view.sources.map((source) => {
                const cell = matrix.cells[cellKey(source.id, candidate.id)];
                return <MatrixMobileCell key={cell.id} cell={cell} receipt={receipts.byCellId[cell.id]} source={source} candidateName={candidate.name} onSelect={setSelectedCellId} />;
              })}
            </div>
          </article>
        ))}
      </div>
      <ReceiptDrawer receipt={selectedReceipt} onClose={() => setSelectedCellId(null)} />
    </section>
  );
}

function MatrixTableCell({
  cell,
  receipt,
  sourceName,
  candidateName,
  onSelect,
}: {
  cell: RecommendationMatrixCell;
  receipt?: RaceReceiptModel;
  sourceName: string;
  candidateName: string;
  onSelect: (cellId: string) => void;
}) {
  const accessibleLabel = `${candidateName} from ${sourceName}: ${cell.positionKindLabel}, ${cell.evidenceCount} evidence references`;
  const receiptStatus = receipt?.status ?? "unavailable";
  const canOpenReceipt = receiptStatus === "available";
  return (
    <td
      id={domCellId(cell)}
      data-matrix-cell-id={cell.id}
      data-matrix-cell-key={cell.key}
      data-source-id={cell.sourceId}
      data-candidate-id={cell.entityId}
      data-position-kind={cell.positionKind ?? "no-public-position"}
      data-receipt-status={receiptStatus}
      data-receipt-evidence-count={receipt?.evidenceCount ?? 0}
      aria-label={accessibleLabel}
    >
      {canOpenReceipt ? (
        <button className="matrix-cell-button" type="button" onClick={() => onSelect(cell.id)} aria-label={`${accessibleLabel}. Open evidence receipt.`}>
          <MatrixCellContent cell={cell} />
        </button>
      ) : (
        <div className="matrix-cell-unavailable" data-receipt-empty-reason={receipt?.emptyReason ?? "no-public-evidence"}>
          <MatrixCellContent cell={cell} />
          <span className="matrix-cell-note">No public receipt available</span>
        </div>
      )}
    </td>
  );
}

function MatrixMobileCell({
  cell,
  receipt,
  source,
  candidateName,
  onSelect,
}: {
  cell: RecommendationMatrixCell;
  receipt?: RaceReceiptModel;
  source: RecommendationMatrixSource;
  candidateName: string;
  onSelect: (cellId: string) => void;
}) {
  const accessibleLabel = `${candidateName}, ${source.name}: ${cell.positionKindLabel}, ${cell.evidenceCount} evidence references`;
  const receiptStatus = receipt?.status ?? "unavailable";
  const canOpenReceipt = receiptStatus === "available";
  return (
    <article
      className="matrix-source-card"
      id={`${domCellId(cell)}-mobile`}
      data-matrix-cell-id={cell.id}
      data-matrix-cell-key={cell.key}
      data-source-id={cell.sourceId}
      data-candidate-id={cell.entityId}
      data-position-kind={cell.positionKind ?? "no-public-position"}
      data-receipt-status={receiptStatus}
      data-receipt-evidence-count={receipt?.evidenceCount ?? 0}
      aria-label={accessibleLabel}
    >
      <div>
        <h4>{source.name}</h4>
        <p>{source.sourceType}</p>
      </div>
      {canOpenReceipt ? (
        <button className="matrix-cell-button" type="button" onClick={() => onSelect(cell.id)} aria-label={`${accessibleLabel}. Open evidence receipt.`}>
          <MatrixCellContent cell={cell} />
        </button>
      ) : (
        <div className="matrix-cell-unavailable" data-receipt-empty-reason={receipt?.emptyReason ?? "no-public-evidence"}>
          <MatrixCellContent cell={cell} />
          <span className="matrix-cell-note">No public receipt available</span>
        </div>
      )}
    </article>
  );
}

function MatrixCellContent({ cell }: { cell: RecommendationMatrixCell }) {
  return (
    <>
      <span className={`position-badge ${cell.state === "position" ? "has-position" : "no-position"}`}>{cell.positionKindLabel}</span>
      <strong>{cell.label}</strong>
      <small>{cell.evidenceCount} evidence</small>
    </>
  );
}

function buildMatrixView(
  matrix: RecommendationMatrixModel,
  options: {
    sourceType: SourceTypeFilter;
    candidateId: CandidateFilter;
    positionKind: PositionKindFilter;
    sortOrder: SortOrder;
    grouping: GroupingMode;
  },
) {
  const sourceType = matrix.filters.sourceTypes.some((option) => option.value === options.sourceType) ? options.sourceType : ALL;
  const candidateId = matrix.candidates.some((candidate) => candidate.id === options.candidateId) ? options.candidateId : ALL;
  const positionKinds = new Set(matrix.filters.positionKinds.map((option) => option.value));
  const positionKind = options.positionKind === ALL || positionKinds.has(options.positionKind) ? options.positionKind : ALL;
  const sortOrder = normalizeSortOrder(options.sortOrder);
  const grouping = normalizeGrouping(options.grouping);

  const candidates = matrix.candidates.filter((candidate) => candidateId === ALL || candidate.id === candidateId);
  const sources = sortSources(
    matrix.sources.filter((source) => {
      if (sourceType !== ALL && source.sourceType !== sourceType) return false;
      if (positionKind === ALL) return true;
      return candidates.some((candidate) => {
        const cell = matrix.cells[cellKey(source.id, candidate.id)];
        return (cell.positionKind ?? "no-public-position") === positionKind;
      });
    }),
    sortOrder,
  );

  const visibleSourceIds = new Set(sources.map((source) => source.id));
  const groups = grouping === "sourceType"
    ? matrix.groups
        .filter((group) => group.sourceIds.some((sourceId) => visibleSourceIds.has(sourceId)))
        .map((group) => {
          const groupSources = sources.filter((source) => group.sourceIds.includes(source.id));
          return {
            ...group,
            sourceCount: groupSources.length,
            evidenceCount: groupSources.reduce((count, source) => count + source.evidenceCount, 0),
            sources: groupSources,
          };
        })
    : [
        {
          id: "all-sources",
          sourceType: "all",
          label: "All sources",
          sourceIds: sources.map((source) => source.id),
          sourceCount: sources.length,
          positionCount: sources.reduce((count, source) => count + source.positionCount, 0),
          evidenceCount: sources.reduce((count, source) => count + source.evidenceCount, 0),
          sources,
        },
      ];

  return { candidates, sources, groups };
}

function sortSources(sources: RecommendationMatrixSource[], sortOrder: SortOrder): RecommendationMatrixSource[] {
  return [...sources].sort((left, right) => {
    if (sortOrder === "source-name") return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    if (sortOrder === "most-evidence") return right.evidenceCount - left.evidenceCount || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    return left.sourceType.localeCompare(right.sourceType) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

function normalizeSortOrder(value: string): SortOrder {
  return value === "source-name" || value === "most-evidence" ? value : "source-type-then-name";
}

function normalizeGrouping(value: string): GroupingMode {
  return value === "none" ? "none" : "sourceType";
}

function cellKey(sourceId: string, candidateId: string): string {
  return `${sourceId}::${candidateId}`;
}

function domCellId(cell: RecommendationMatrixCell): string {
  return `matrix-cell-${safeDomId(cell.sourceId)}-${safeDomId(cell.entityId)}`;
}

function safeDomId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}
