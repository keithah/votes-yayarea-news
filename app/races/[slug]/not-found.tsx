import Link from "next/link";

export default function PublicRaceNotFound() {
  return (
    <main className="race-page-shell">
      <section className="race-hero" aria-labelledby="missing-race-title">
        <div className="race-hero-copy">
          <p className="eyebrow">Public race shell</p>
          <h1 id="missing-race-title">Race not found</h1>
          <p className="lede">
            This race is missing or has not passed the public review and publication gates yet.
          </p>
          <Link className="button button-primary" href="/#public-races">
            Back to public races
          </Link>
        </div>
      </section>
    </main>
  );
}
