import type { Metadata } from "next";
import Link from "next/link";
import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "votes.yayarea.news · San Francisco election guide",
    template: "%s · votes.yayarea.news",
  },
  description:
    "Static public race discovery for San Francisco election endorsements, source counts, evidence, and reviewed public race shells.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="site-frame">
          <header className="site-header" aria-label="Site header">
            <Link className="site-logo" href="/" aria-label="votes.yayarea.news home">
              <span className="logo-mark" aria-hidden="true">
                v
              </span>
              <span>votes.yayarea.news</span>
            </Link>
            <nav className="site-nav" aria-label="Primary navigation">
              <a href="/#public-races">Races</a>
              <a href="/#methodology">Methodology</a>
            </nav>
          </header>
          {children}
          <footer className="site-footer">
            <p>
              Static public election guide in progress. Race pages show reviewed public data and
              label unfinished matrix, receipt, AI disclosure, and drill-down surfaces as
              placeholders.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
