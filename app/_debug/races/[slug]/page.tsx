import { notFound } from "next/navigation";
import { listRaceSlugs, loadRaceData, type LoadedRaceData } from "../../../../lib/data/loaders";
import type { Evidence, Race } from "../../../../lib/data/types";

export const dynamic = "force-static";
export const dynamicParams = false;

interface RaceDebugModel {
  race: Race;
  counts: {
    sources: number;
    entities: number;
    positions: number;
    evidence: number;
  };
  hasManualOverride: boolean;
  evidence: Evidence[];
  checkedFiles: string[];
  diagnostics: string[];
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  if (process.env.INCLUDE_LOCAL_REVIEW_ROUTES !== "true") return [];
  const slugs = await listRaceSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function buildRaceDebugModel(slug: string): Promise<RaceDebugModel | null> {
  const loaded = await loadRaceData(slug);
  if (!loaded) return null;
  return summarizeRaceDebug(loaded);
}

export default async function RaceDebugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const model = await buildRaceDebugModel(slug);

  if (!model) notFound();

  const { race, counts, evidence, hasManualOverride, checkedFiles, diagnostics } = model;

  return (
    <main className="debug-shell">
      <header className="debug-header">
        <p className="eyebrow">Data debug</p>
        <h1>{race.title}</h1>
        <dl className="debug-facts" aria-label="Race debug facts">
          <div>
            <dt>Slug</dt>
            <dd>{race.slug}</dd>
          </div>
          <div>
            <dt>Completeness</dt>
            <dd>{race.status}</dd>
          </div>
          <div>
            <dt>Publication</dt>
            <dd>{race.publicationStatus}</dd>
          </div>
          <div>
            <dt>Manual override</dt>
            <dd>{hasManualOverride ? "present" : "absent"}</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="counts-title" className="debug-card">
        <h2 id="counts-title">Loaded counts</h2>
        <table className="debug-table">
          <tbody>
            <tr>
              <th scope="row">Sources</th>
              <td>{counts.sources}</td>
            </tr>
            <tr>
              <th scope="row">Entities / candidates</th>
              <td>{counts.entities}</td>
            </tr>
            <tr>
              <th scope="row">Positions</th>
              <td>{counts.positions}</td>
            </tr>
            <tr>
              <th scope="row">Evidence</th>
              <td>{counts.evidence}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="diagnostics-title" className="debug-card">
        <h2 id="diagnostics-title">Diagnostics</h2>
        <ul className="debug-list">
          {diagnostics.map((diagnostic) => (
            <li key={diagnostic}>{diagnostic}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="evidence-title" className="debug-card">
        <h2 id="evidence-title">Evidence snippets and source URLs</h2>
        {evidence.length > 0 ? (
          <ul className="debug-list evidence-list">
            {evidence.map((item) => (
              <li key={item.id}>
                <strong>{item.id}</strong>
                <p>{compactQuote(item.quote)}</p>
                <a href={item.url}>{item.url}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No evidence records loaded for this race.</p>
        )}
      </section>

      <section aria-labelledby="files-title" className="debug-card">
        <h2 id="files-title">Checked fixture summary</h2>
        <p>{checkedFiles.length} local fixture inputs were inspected by the loader.</p>
      </section>
    </main>
  );
}

function summarizeRaceDebug({ race, checkedFiles }: LoadedRaceData): RaceDebugModel {
  const evidence = race.positions.flatMap((position) => position.evidence);
  const diagnostics = [
    race.positions.length === 0 ? "No positions loaded for this race." : `${race.positions.length} position records loaded.`,
    evidence.length === 0 ? "No evidence loaded for this race." : `${evidence.length} evidence records loaded.`,
  ];

  return {
    race,
    checkedFiles,
    counts: {
      sources: race.sourceIds.length,
      entities: race.entityIds.length,
      positions: race.positions.length,
      evidence: evidence.length,
    },
    hasManualOverride: checkedFiles.some((file) => file.includes("manual/overrides/races/")),
    evidence,
    diagnostics,
  };
}

function compactQuote(quote: string): string {
  return quote.length > 180 ? `${quote.slice(0, 177)}...` : quote;
}
