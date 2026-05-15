import type { Metadata } from "next";
import type { EntityDrilldownModel, SourceDrilldownModel } from "../ui/drilldowns";
import type { RaceUiModel } from "../ui/race";

export const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://votes.yayarea.news";
export const SITE_NAME = "votes.yayarea.news";
export const DEFAULT_SHARE_IMAGE_PATH = "/share/votes-yayarea-news.svg";

const DEFAULT_TITLE = "votes.yayarea.news · San Francisco election guide";
const DEFAULT_DESCRIPTION =
  "Static public race discovery for San Francisco election source records, source counts, evidence receipts, and reviewed AI-use disclosure.";
const DISCLOSURE_DESCRIPTION =
  "How votes.yayarea.news uses AI assistance, human review, evidence, and publication gates for public election source records.";
const TEXT_FALLBACK = "Public San Francisco election source records and evidence receipts.";
const INTERNAL_PATH_PATTERN = /(?:^|[\s"'(`])(?:\.gsd(?:\/|$)|manual\/(?:reviews|overrides)\/|data\/(?:public|extracted|ingested)\/|\/home\/|file:|tmp\/)/i;
const ENDORSEMENT_LANGUAGE_PATTERN = /\b(?:vote\s+for|must\s+support|we\s+recommend|our\s+pick|best\s+choice)\b/i;

export interface HomeShareCounts {
  raceCount: number;
  sourceCount: number;
  evidenceCount: number;
}

export interface ShareMetadataInput {
  path: string;
  title?: string | null;
  description?: string | null;
  imagePath?: string | null;
}

export function buildSiteShareMetadata(input: Partial<ShareMetadataInput> = {}): Metadata {
  return buildShareMetadata({
    path: input.path ?? "/",
    title: input.title ?? DEFAULT_TITLE,
    description: input.description ?? DEFAULT_DESCRIPTION,
    imagePath: input.imagePath,
  });
}

export function buildHomeShareMetadata(counts?: HomeShareCounts): Metadata {
  const description = counts
    ? `Static San Francisco election source tracker with ${counts.raceCount} public races, ${counts.sourceCount} reviewed sources, and ${counts.evidenceCount} evidence items.`
    : DEFAULT_DESCRIPTION;
  return buildShareMetadata({
    path: "/",
    title: DEFAULT_TITLE,
    description,
  });
}

export function buildRaceShareMetadata(ui: RaceUiModel | null | undefined, path?: string): Metadata {
  if (!ui) return buildSiteShareMetadata({ path: path ?? "/races/" });
  return buildShareMetadata({
    path: path ?? `/races/${ui.race.slug}/`,
    title: `${ui.race.title} source records`,
    description: `Public source tracker for ${ui.race.title}: ${ui.sourceCount} sources, ${ui.candidates.length} entities, and ${ui.evidenceCount} evidence items.`,
  });
}

export function buildEntityShareMetadata(model: EntityDrilldownModel | null | undefined, path?: string): Metadata {
  if (!model || model.availability !== "available" || !model.entity) {
    return buildSiteShareMetadata({ path: path ?? "/entities/" });
  }
  return buildShareMetadata({
    path: path ?? `/entities/${model.entity.slug}/`,
    title: `${model.entity.name} public source trail`,
    description: `${model.entity.name} public source trail across ${model.counts.relatedRaceCount} races: ${model.counts.publicPositionCount} tracked source records and ${model.counts.evidenceCount} evidence items.`,
  });
}

export function buildSourceShareMetadata(model: SourceDrilldownModel | null | undefined, path?: string): Metadata {
  if (!model || model.availability !== "available" || !model.source) {
    return buildSiteShareMetadata({ path: path ?? "/sources/" });
  }
  return buildShareMetadata({
    path: path ?? `/sources/${model.source.slug}/`,
    title: `${model.source.name} public source trail`,
    description: `${model.source.name} public source trail across ${model.counts.relatedRaceCount} races: ${model.counts.publicPositionCount} tracked source records and ${model.counts.evidenceCount} evidence items.`,
  });
}

export function buildDisclosureShareMetadata(): Metadata {
  return buildShareMetadata({
    path: "/how-we-use-ai/",
    title: "How we use AI",
    description: DISCLOSURE_DESCRIPTION,
  });
}

export function buildShareMetadata(input: ShareMetadataInput): Metadata {
  const canonicalPath = normalizeCanonicalPath(input.path);
  const canonicalUrl = absoluteUrl(canonicalPath);
  const imagePath = normalizeAssetPath(input.imagePath ?? DEFAULT_SHARE_IMAGE_PATH);
  const imageUrl = absoluteAssetUrl(imagePath);
  const title = sanitizeShareText(input.title, DEFAULT_TITLE);
  const description = sanitizeShareText(input.description, DEFAULT_DESCRIPTION);

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: SITE_NAME,
      title,
      description,
      url: canonicalUrl,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} public election source tracker`,
          type: "image/svg+xml",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export function normalizeCanonicalPath(path: string): string {
  const rawPath = path.trim() || "/";
  let pathname: string;
  try {
    pathname = rawPath.startsWith("http://") || rawPath.startsWith("https://") ? new URL(rawPath).pathname : rawPath;
  } catch {
    pathname = "/";
  }
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const withoutQuery = withLeadingSlash.split(/[?#]/, 1)[0] || "/";
  const collapsed = withoutQuery.replace(/\/+/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

export function absoluteUrl(path: string): string {
  return new URL(normalizeCanonicalPath(path), SITE_ORIGIN).toString();
}

export function absoluteAssetUrl(path: string): string {
  return new URL(normalizeAssetPath(path), SITE_ORIGIN).toString();
}

export function sanitizeShareText(value: string | null | undefined, fallback = TEXT_FALLBACK): string {
  const candidate = String(value ?? "")
    .replace(/[`*_<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate) return fallback;
  if (INTERNAL_PATH_PATTERN.test(candidate) || ENDORSEMENT_LANGUAGE_PATTERN.test(candidate)) return fallback;
  return candidate.length > 220 ? `${candidate.slice(0, 217).trimEnd()}…` : candidate;
}

function normalizeAssetPath(path: string): string {
  if (!path || path.startsWith("http://") || path.startsWith("https://")) return DEFAULT_SHARE_IMAGE_PATH;
  const normalized = normalizeCanonicalPath(path);
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
