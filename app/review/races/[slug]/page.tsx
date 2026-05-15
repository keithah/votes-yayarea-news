import { promises as fs } from "node:fs";
import { notFound } from "next/navigation";
import { listRaceSlugs, loadRaceData } from "../../../../lib/data/loaders";
import { readRaceReviewModel, type PositionReviewFile, type ReviewIssue } from "../../../../lib/review/positions";

interface ExtractionRunView {
  id?: string;
  status?: string;
  provider?: { provider?: string; model?: string };
  counts?: { positions?: number; evidence?: number; errors?: number; warnings?: number };
  outputPath?: string;
  validationPath?: string;
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await listRaceSlugs();
  return slugs.map((slug) => ({ slug }));
}

export default async function RaceReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadRaceData(slug);
  if (!loaded) notFound();

  const [{ review, issues, reviewPath, draftPath }, run] = await Promise.all([readRaceReviewModel(slug), readLatestRun()]);
  const race = loaded.race;

  return (
    <main className="debug-shell">
      <header className="debug-header">
        <p className="eyebrow">Local extraction review</p>
        <h1>{race.title}</h1>
        <p className="lede">Inspect generated position drafts here, then edit the local review JSON and publish with the CLI. This static page never writes files.</p>
        <dl className="debug-facts" aria-label="Review facts">
          <div>
            <dt>Race slug</dt>
            <dd>{slug}</dd>
          </div>
          <div>
            <dt>Review status</dt>
            <dd>{review?.status ?? "not prepared"}</dd>
          </div>
          <div>
            <dt>Run status</dt>
            <dd>{run?.status ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Publish ready</dt>
            <dd>{countReady(review)} ready</dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="workflow-title" className="debug-card">
        <h2 id="workflow-title">Workflow</h2>
        <ol className="debug-list">
          <li>
            Prepare review JSON: <code>pnpm review:positions prepare --race-slug {slug}</code>
          </li>
          <li>
            Edit <code>{reviewPath}</code>: set reviewed positions to <code>status: verified</code> and <code>publicationStatus: public</code>, or set rejected/hidden records to keep them private.
          </li>
          <li>
            Check readiness: <code>pnpm review:positions status --race-slug {slug}</code>
          </li>
          <li>
            Publish verified public records: <code>pnpm review:positions publish --race-slug {slug}</code>
          </li>
        </ol>
      </section>

      <section aria-labelledby="run-title" className="debug-card">
        <h2 id="run-title">Extraction run</h2>
        <table className="debug-table">
          <tbody>
            <tr>
              <th scope="row">Run ID</th>
              <td>{run?.id ?? review?.runId ?? "unknown"}</td>
            </tr>
            <tr>
              <th scope="row">Provider</th>
              <td>{run?.provider ? `${run.provider.provider ?? "unknown"} / ${run.provider.model ?? "unknown"}` : providerLabel(review)}</td>
            </tr>
            <tr>
              <th scope="row">Draft path</th>
              <td><code>{review?.sourceDraftPath ?? draftPath}</code></td>
            </tr>
            <tr>
              <th scope="row">Run outputs</th>
              <td>{run?.outputPath ? <code>{run.outputPath}</code> : "not available"} {run?.validationPath ? <code>{run.validationPath}</code> : null}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="readiness-title" className="debug-card">
        <h2 id="readiness-title">Review diagnostics</h2>
        {issues.length > 0 ? <IssueList issues={issues} /> : <p>No review diagnostics. Verified public records are publish-ready.</p>}
      </section>

      <section aria-labelledby="positions-title" className="debug-card">
        <h2 id="positions-title">Draft positions</h2>
        {review && review.positions.length > 0 ? (
          <ul className="debug-list evidence-list">
            {review.positions.map((position) => (
              <li key={position.id}>
                <h3>{position.label}</h3>
                <p>
                  <strong>{position.status}</strong> / <strong>{position.publicationStatus}</strong> · <code>{position.id}</code>
                </p>
                <p>Entity <code>{position.entityId}</code>, source <code>{position.sourceId}</code>, draft <code>{position.draftPositionId}</code></p>
                {position.rationale ? <p>{position.rationale}</p> : null}
                {position.reviewerNotes ? <p>Reviewer notes: {position.reviewerNotes}</p> : null}
                <ul className="debug-list">
                  {position.evidence.map((evidence) => (
                    <li key={evidence.id}>
                      <strong>{evidence.id}</strong> · artifact <code>{evidence.artifactId}</code> · chunk <code>{evidence.chunkId}</code>
                      <p>{evidence.quote}</p>
                      <a href={evidence.url}>{evidence.url}</a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p>No prepared review file exists yet. Run prepare to create <code>{reviewPath}</code>.</p>
        )}
      </section>
    </main>
  );
}

function IssueList({ issues }: { issues: ReviewIssue[] }) {
  return (
    <ul className="debug-list">
      {issues.map((issue) => (
        <li key={`${issue.phase}:${issue.path}:${issue.code}`}>
          <strong>{issue.severity}</strong> {issue.phase} <code>{issue.path}</code> [{issue.code}] {issue.message}
        </li>
      ))}
    </ul>
  );
}

async function readLatestRun(): Promise<ExtractionRunView | null> {
  try {
    return JSON.parse(await fs.readFile("data/extracted/runs/latest.json", "utf8")) as ExtractionRunView;
  } catch {
    return null;
  }
}

function countReady(review: PositionReviewFile | null): number {
  return review?.positions.filter((position) => position.publicationStatus === "public" && (position.status === "verified" || position.status === "published")).length ?? 0;
}

function providerLabel(review: PositionReviewFile | null): string {
  if (!review) return "unknown";
  return `${review.provider.provider} / ${review.provider.model}`;
}
