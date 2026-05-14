const launchDirectories = ['data', 'manual', 'scripts', 'site', 'decisions'] as const;

export default function Home() {
  return (
    <main className="home-shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Launch scaffold</p>
        <h1 id="page-title">votes.yayarea.news</h1>
        <p className="lede">
          A static Bay Area election guide is being assembled here. Source, race, and framework
          decisions are locked in the repository while data and interface slices are built next.
        </p>
      </section>

      <section className="checklist" aria-labelledby="scaffold-title">
        <h2 id="scaffold-title">Expected launch layout</h2>
        <ul>
          {launchDirectories.map((directory) => (
            <li key={directory}>
              <code>{directory}/</code>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
