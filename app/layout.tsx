import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsProvider } from "./analytics-provider";
import { buildSiteShareMetadata } from "../lib/share/metadata";
import "./styles.css";

export const metadata: Metadata = buildSiteShareMetadata();

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AnalyticsProvider />
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
              Static public election guide in progress. Race pages show reviewed public data, live
              source-by-candidate recommendation matrices, evidence receipts, and reviewed AI
              summary support.
            </p>
            <nav className="footer-nav" aria-label="Footer navigation">
              <Link href="/how-we-use-ai" data-footer-disclosure-link="how-we-use-ai">
                How we use AI
              </Link>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  );
}
