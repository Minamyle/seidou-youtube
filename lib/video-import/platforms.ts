import type { VideoPlatform } from "./config"

export interface DetectedVideo {
  platform: VideoPlatform
  externalId: string
}

/**
 * Matches the same YouTube URL shapes the rest of the app already supports,
 * plus /shorts/ links.
 */
const YOUTUBE_PATTERNS: RegExp[] = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#/]+)/,
  /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  /^([a-zA-Z0-9_-]{11})$/,
]

/**
 * Matches x.com / twitter.com status URLs, including /statuses/, /video/1,
 * /photo/1 suffixes and query strings such as ?s=20.
 * Short t.co links cannot be resolved without a network call, so they are
 * rejected with a clear message instead of being guessed.
 */
const X_STATUS_PATTERN =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/web\/|[^/?#]+\/)?status(?:es)?\/(\d+)/i

export function detectVideoPlatform(url: string): DetectedVideo | null {
  const value = url.trim()
  if (!value) return null

  for (const pattern of YOUTUBE_PATTERNS) {
    const match = value.match(pattern)
    if (match?.[1]) {
      return { platform: "youtube", externalId: match[1] }
    }
  }

  const match = value.match(X_STATUS_PATTERN)
  if (match?.[1]) {
    return { platform: "x", externalId: match[1] }
  }

  return null
}

export const PLATFORM_LABELS: Record<VideoPlatform, string> = {
  youtube: "YouTube",
  x: "X (Twitter)",
}

export function formatPlatformSummary(
  platforms: VideoPlatform[],
  counts: Record<VideoPlatform, number>,
): string {
  return platforms.map((platform) => `${PLATFORM_LABELS[platform]} (${counts[platform]})`).join(", ")
}
