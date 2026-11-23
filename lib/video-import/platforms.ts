import { RETAIL_PLATFORMS, SUPPORTED_PLATFORMS, type RetailPlatform, type VideoPlatform } from "./config"

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

/**
 * Retailers have no embed API, so a retail record is identified by its product
 * page. Each entry checks the host and pulls the stable product ID from the
 * path or query string. The media URL is never used as identity because
 * retailer CDN links can change or expire.
 */
const RETAIL_HOST_PATTERNS: Record<RetailPlatform, RegExp> = {
  // asos.com plus country sites such as asos.de / asos.fr
  asos: /(?:^|\.)asos\.(?:com|de|fr|it|es|nl|se|dk|pl|com\.au)$/i,
  // Temu serves every country from temu.com (country lives in the path)
  temu: /(?:^|\.)temu\.com$/i,
  // shein.com plus regional sites such as us.shein.com, shein.co.uk, shein.com.mx
  shein: /(?:^|\.)shein\.(?:com|co\.uk|com\.mx|com\.au|ca|de|fr|it|es|nl|se|pl|in)$/i,
}

const RETAIL_PRODUCT_ID_PATTERNS: Record<RetailPlatform, RegExp[]> = {
  // https://www.asos.com/brand/name/prd/210636221 or legacy ?productid=210636221
  asos: [/\/prd\/(\d{5,})/i, /[?&]productid=(\d{5,})/i],
  // https://www.temu.com/goods.html?goods_id=601099512345 or /uk/name-g-601101955527840.html
  temu: [/[?&]goods_id=(\d{6,})/i, /-g-(\d{6,})\.html/i],
  // https://us.shein.com/Some-Dress-p-515174062.html (also -cat- variants carry -p-<id>)
  shein: [/-p-(\d{4,})(?:-cat-\d+)?\.html/i, /[?&]goods_id=(\d{4,})/i],
}

export function isRetailPlatform(platform: VideoPlatform | null | undefined): platform is RetailPlatform {
  return platform != null && (RETAIL_PLATFORMS as readonly string[]).includes(platform)
}

/**
 * True when every record in a batch is an ASOS, Temu or SHEIN product picture.
 * Such batches do not need a batch image, because each product already has
 * its own picture. Mixed batches (videos and products) still need one.
 */
export function isProductBatch(platforms: readonly VideoPlatform[]): boolean {
  return platforms.length > 0 && platforms.every((platform) => isRetailPlatform(platform))
}

/** Returns the retailer for a URL's host, regardless of whether it is a product page. */
export function detectRetailHost(url: string): RetailPlatform | null {
  let host: string
  try {
    host = new URL(url.trim()).hostname
  } catch {
    return null
  }

  for (const platform of RETAIL_PLATFORMS) {
    if (RETAIL_HOST_PATTERNS[platform].test(host)) return platform
  }
  return null
}

function detectRetailProduct(value: string): DetectedVideo | null {
  const platform = detectRetailHost(value)
  if (!platform) return null

  for (const pattern of RETAIL_PRODUCT_ID_PATTERNS[platform]) {
    const match = value.match(pattern)
    if (match?.[1]) {
      return { platform, externalId: match[1] }
    }
  }
  return null
}

/**
 * Builds a clean product page URL: drops tracking query strings and fragments,
 * but keeps the query when the product ID lives there (Temu goods.html,
 * legacy ASOS productid links).
 */
export function canonicalRetailUrl(url: string): string | null {
  const detected = detectRetailProduct(url)
  if (!detected) return null

  const parsed = new URL(url.trim())
  parsed.protocol = "https:"
  parsed.hash = ""

  const idInPath = parsed.pathname.includes(detected.externalId)
  if (idInPath) {
    parsed.search = ""
  } else if (detected.platform === "temu") {
    parsed.search = `?goods_id=${detected.externalId}`
  } else if (detected.platform === "asos") {
    parsed.search = `?productid=${detected.externalId}`
  } else {
    parsed.search = `?goods_id=${detected.externalId}`
  }

  return parsed.toString()
}

export function detectVideoPlatform(url: string): DetectedVideo | null {
  const value = url.trim()
  if (!value) return null

  // Retail hosts are checked first so a product URL whose slug happens to
  // contain "youtu.be/" or similar text can never be mistaken for YouTube.
  const retail = detectRetailProduct(value)
  if (retail) return retail
  if (detectRetailHost(value)) return null

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
  asos: "ASOS",
  temu: "Temu",
  shein: "SHEIN",
}

/** "YouTube, X (Twitter), ASOS, Temu or SHEIN" - used in user-facing messages. */
export const SUPPORTED_PLATFORM_LIST = (() => {
  const labels = SUPPORTED_PLATFORMS.map((platform) => PLATFORM_LABELS[platform])
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`
})()

export function emptyPlatformCounts(): Record<VideoPlatform, number> {
  return Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [platform, 0])) as Record<VideoPlatform, number>
}

export function formatPlatformSummary(
  platforms: VideoPlatform[],
  counts: Record<VideoPlatform, number>,
): string {
  return platforms.map((platform) => `${PLATFORM_LABELS[platform]} (${counts[platform]})`).join(", ")
}
