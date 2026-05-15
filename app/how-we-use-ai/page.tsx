import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "How we use AI",
  description:
    "A public disclosure of how votes.yayarea.news uses AI assistance, human review, evidence, and publication gates.",
};

const disclosureSections = [
  {
    id: "what-ai-does",
    eyebrow: "AI assistance",
    title: "What AI helps with",
    body: [
      "AI tools may help organize public voter-guide material, identify candidate/source relationships, draft neutral summaries, and prepare evidence-backed comparison surfaces for review.",
      "AI output is treated as a draft signal, not as a final recommendation or an independent source of truth.",
    ],
  },
  {
    id: "human-review",
    eyebrow: "Human review",
    title: "What humans review",
    body: [
      "Public race pages are gated behind review and publication status before they appear on the static site.",
      "Humans review source attribution, candidate names, evidence links, quote context, summary wording, and whether a race is ready for public display.",
    ],
  },
  {
    id: "never-automated",
    eyebrow: "Boundaries",
    title: "What is never automated",
    body: [
      "The site does not let AI invent endorsements, create unsupported claims, or publish hidden/draft records as public guidance.",
      "AI does not decide how anyone should vote. Public pages should show the source trail so readers can inspect the underlying material themselves.",
    ],
  },
  {
    id: "evidence-requirements",
    eyebrow: "Evidence",
    title: "Evidence requirements",
    body: [
      "Receipt and summary surfaces are expected to point back to public evidence such as a source name, quote or excerpt, link when available, and publication status.",
      "If a public position has no available receipt, the interface should say so instead of opening an empty or misleading detail panel.",
    ],
  },
  {
    id: "public-status-gating",
    eyebrow: "Publication gates",
    title: "Public status controls what appears",
    body: [
      "The static site is built from records that pass public review and publication gates. Draft, rejected, hidden, or otherwise unpublished records should remain out of public route output.",
      "When there is not enough reviewed public data, pages should show an explicit empty or pending state rather than filling gaps with generated copy.",
    ],
  },
  {
    id: "limitations",
    eyebrow: "Limitations",
    title: "Known limitations",
    body: [
      "The guide is an in-progress public snapshot. Counts and summaries can lag source updates, and source material can be incomplete, ambiguous, or corrected after publication.",
      "Readers should use linked sources and official election information for final decisions, deadlines, and ballot details.",
    ],
  },
  {
    id: "corrections",
    eyebrow: "Corrections",
    title: "Questions and corrections",
    body: [
      "If something looks wrong, missing, or misattributed, use the public source links on race pages to compare the claim against the underlying material and contact the site maintainers with the race, source, and evidence details.",
      "Corrections should be grounded in public source material so the static record can be reviewed and updated without exposing private notes or credentials.",
    ],
  },
];

export default function HowWeUseAiPage() {
  return (
    <main className="disclosure-shell" data-disclosure-route="how-we-use-ai">
      <section className="disclosure-hero" aria-labelledby="disclosure-title">
        <p className="eyebrow">AI disclosure</p>
        <h1 id="disclosure-title">How we use AI</h1>
        <p className="lede">
          votes.yayarea.news uses AI as an assistance layer for organizing and summarizing public
          election source material. Public pages should remain evidence-grounded, human-reviewed,
          and clear about what is known, what is missing, and what is still being built.
        </p>
      </section>

      <section className="disclosure-grid" aria-label="AI use disclosure sections">
        {disclosureSections.map((section) => (
          <article
            className="disclosure-card"
            data-disclosure-section={section.id}
            id={section.id}
            key={section.id}
            aria-labelledby={`${section.id}-title`}
          >
            <p className="eyebrow">{section.eyebrow}</p>
            <h2 id={`${section.id}-title`}>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </article>
        ))}
      </section>
    </main>
  );
}
