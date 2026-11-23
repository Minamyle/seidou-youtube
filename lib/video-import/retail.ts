import type { RetailPlatform } from "./config"
import { decodeHtmlEntities, parseAttributes, stripHtml, truncate } from "./html-utils"
import {
  canonicalRetailUrl,
  detectRetailHost,
  detectVideoPlatform,
  isRetailPlatform,
  PLATFORM_LABELS,
} from "./platforms"
import type { ValidationIssue } from "./validation"

/**
 * Parses pages saved from ASOS, Temu and SHEIN into product picture posts.
 *
 * Each record is one product: its page link (videoUrl, used as identity), its
 * title, and its main picture (imageUrl), which the app shows in the feed.
 *
 * Two kinds of page are supported:
 *
 *   product page          -> one record. Picture from JSON-LD Product, then
 *                            og:image, then the first product gallery image.
 *   search/category page  -> one record per product card, using each card's
 *                            link and image (including lazy-loaded data-src).
 *
 * Products without a picture are skipped with a warning; no URL is invented.
 */

export interface RetailRecord {
  category: string
  channelName: string
  videoUrl: string
  videoTitle: string
  platform: RetailPlatform
  actualChannelName: string | null
  isUnrelatedChannel: boolean
  imageUrl: string
}

interface RetailDefaults {
  category: string
  channelName: string
}

interface LdProduct {
  name: string | null
  url: string | null
  brand: string | null
  image: string | null
}

const DEFAULT_ORIGINS: Record<RetailPlatform, string> = {
  asos: "https://www.asos.com",
  temu: "https://www.temu.com",
  shein: "https://us.shein.com",
}

/** Image CDNs each retailer serves product pictures from. */
const PRODUCT_IMAGE_HOSTS: Record<RetailPlatform, RegExp> = {
  asos: /(?:^|\.)asos-media\.com$/i,
  temu: /(?:^|\.)(?:kwcdn\.com|temucdn\.com)$/i,
  shein: /(?:^|\.)(?:ltwebstatic\.com|shein\.com)$/i,
}

/** Logos, icons and sprites are never product pictures. */
const NON_PRODUCT_IMAGE = /(?:logo|icon|sprite|avatar|badge|flag|placeholder|blank|loading)/i

/** Strips "| ASOS", " - Temu United Kingdom", " | SHEIN USA" from page titles. */
const TITLE_SUFFIX = /(?:\s*\|\s*|\s+[-–—:]\s+)(?:ASOS(?:\.com)?|Temu|SHEIN)(?:\s+[A-Za-z]+){0,3}\s*$/i

/**
 * Works out which retailer a saved page came from, using the page's own URL
 * (canonical, og:url, <base>, or the comment Chrome adds when saving). When
 * the page has no URL of its own, falls back to the retailer with the most
 * product links.
 */
export function detectRetailPage(html: string): RetailPlatform | null {
  const pageUrls = getPageUrls(html)
  for (const url of pageUrls) {
    const platform = detectRetailHost(url)
    if (platform) return platform
  }

  // The page says it is from another site (e.g. an X or YouTube page where
  // people shared shop links), so it is not a retailer page.
  if (pageUrls.length > 0) return null

  const counts = new Map<RetailPlatform, Set<string>>()
  for (const { href } of findAnchors(html)) {
    if (!/^https?:\/\//i.test(href)) continue
    const detected = detectVideoPlatform(href)
    if (!detected || !isRetailPlatform(detected.platform)) continue
    const ids = counts.get(detected.platform) ?? new Set<string>()
    ids.add(detected.externalId)
    counts.set(detected.platform, ids)
  }

  let best: RetailPlatform | null = null
  let bestCount = 0
  for (const [platform, ids] of counts) {
    if (ids.size > bestCount) {
      best = platform
      bestCount = ids.size
    }
  }

  // A couple of stray product links (e.g. an ad) are not enough to treat the
  // whole page as a retailer listing.
  return bestCount >= 3 ? best : null
}

export function extractRetailRecords(
  html: string,
  platform: RetailPlatform,
  defaults: RetailDefaults,
  issues: ValidationIssue[],
): RetailRecord[] {
  const products = readJsonLdProducts(html)
  const pageUrls = getPageUrls(html)
  const origin = pageUrls.map((url) => originOf(url, platform)).find(Boolean) ?? DEFAULT_ORIGINS[platform]

  const productPageUrl = pageUrls
    .map((url) => canonicalRetailUrl(url))
    .find((url): url is string => url !== null && detectVideoPlatform(url)?.platform === platform)

  if (productPageUrl) {
    const { imageUrl, ...record } = extractProductPage(html, platform, productPageUrl, products, defaults)
    if (!imageUrl) {
      issues.push({
        severity: "warning",
        message: `No product picture was found for "${record.videoTitle}", so it was skipped. Scroll through the product's pictures, then save the page again.`,
      })
      return []
    }
    return [{ ...record, imageUrl }]
  }

  return extractListing(html, platform, origin, products, defaults, issues)
}

function extractProductPage(
  html: string,
  platform: RetailPlatform,
  productUrl: string,
  products: LdProduct[],
  defaults: RetailDefaults,
): Omit<RetailRecord, "imageUrl"> & { imageUrl: string | null } {
  const label = PLATFORM_LABELS[platform]
  const productId = detectVideoPlatform(productUrl)?.externalId ?? ""
  const product = pickProduct(products, productId)

  const title =
    cleanTitle(product?.name) ||
    cleanTitle(getMeta(html, "og:title")) ||
    cleanTitle(stripHtml(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")) ||
    cleanTitle(stripHtml(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "")) ||
    `${label} product ${productId}`

  const brand = product?.brand?.trim() || null
  const imageUrl =
    absoluteUrl(product?.image) ?? absoluteUrl(getMeta(html, "og:image")) ?? findFirstProductImage(html, platform)

  return {
    category: defaults.category,
    channelName: pickChannelName(defaults.channelName, brand, platform),
    videoUrl: productUrl,
    videoTitle: truncate(title),
    platform,
    actualChannelName: brand,
    isUnrelatedChannel: false,
    imageUrl,
  }
}

function extractListing(
  html: string,
  platform: RetailPlatform,
  origin: string,
  products: LdProduct[],
  defaults: RetailDefaults,
  issues: ValidationIssue[],
): RetailRecord[] {
  const label = PLATFORM_LABELS[platform]

  interface Candidate {
    url: string
    title: string
    imageUrl: string | null
    brand: string | null
  }

  const byId = new Map<string, Candidate>()

  const consider = (rawUrl: string | null | undefined, title: string, imageUrl: string | null, brand: string | null) => {
    if (!rawUrl) return
    const resolved = resolveUrl(rawUrl, origin)
    if (!resolved) return
    const detected = detectVideoPlatform(resolved)
    if (!detected || detected.platform !== platform) return
    const url = canonicalRetailUrl(resolved)
    if (!url) return

    const existing = byId.get(detected.externalId)
    if (!existing) {
      byId.set(detected.externalId, { url, title, imageUrl, brand })
      return
    }
    if (title.length > existing.title.length) existing.title = title
    existing.imageUrl ??= imageUrl
    existing.brand ??= brand
  }

  for (const product of products) {
    consider(product.url, cleanTitle(product.name), absoluteUrl(product.image), product.brand)
  }

  for (const { href, attributes, inner } of findAnchors(html)) {
    const imgTag = /<img\b[^>]*>/i.exec(inner)?.[0]
    const img = imgTag ? parseAttributes(imgTag) : null
    const title =
      cleanTitle(stripHtml(inner)) ||
      cleanTitle(attributes["title"]) ||
      cleanTitle(attributes["aria-label"]) ||
      cleanTitle(img?.alt)
    consider(href, title, img ? imageFromAttributes(img) : null, null)
  }

  const records: RetailRecord[] = []
  let missingImage = 0

  for (const [id, candidate] of byId) {
    if (!candidate.imageUrl) {
      missingImage += 1
      continue
    }
    records.push({
      category: defaults.category,
      channelName: pickChannelName(defaults.channelName, candidate.brand, platform),
      videoUrl: candidate.url,
      videoTitle: truncate(candidate.title || `${label} product ${id}`),
      platform,
      actualChannelName: candidate.brand,
      isUnrelatedChannel: false,
      imageUrl: candidate.imageUrl,
    })
  }

  if (missingImage > 0) {
    issues.push({
      severity: "warning",
      message: `${missingImage} product${missingImage === 1 ? " was" : "s were"} skipped because no picture had loaded. Scroll slowly down the page until every picture shows, then save it again.`,
    })
  }

  return records
}

/** Picks the real image from an <img>, preferring lazy-load attributes over placeholder src values. */
function imageFromAttributes(attributes: Record<string, string>): string | null {
  // srcset comes first: it lists real CDN sizes, while a saved page's src is
  // often a local copy ("./page_files/saved_resource") or a tiny placeholder.
  const candidates = [
    pickFromSrcset(attributes["srcset"]),
    pickFromSrcset(attributes["data-srcset"]),
    attributes["data-src"],
    attributes["data-original"],
    attributes["data-lazy-src"],
    attributes["src"],
  ]
  for (const candidate of candidates) {
    const url = absoluteUrl(candidate)
    if (url && !NON_PRODUCT_IMAGE.test(url)) return url
  }
  return null
}

/** Feed pictures are shown at phone width; ~1000px stays sharp on high-density screens. */
const TARGET_IMAGE_WIDTH = 1000

/**
 * Picks the best entry from a srcset: the widest one up to TARGET_IMAGE_WIDTH
 * (or the narrowest above it when every entry is larger). Density srcsets
 * ("1x, 2x") pick the highest density up to 2x.
 */
export function pickFromSrcset(value: string | undefined): string | null {
  if (!value) return null

  const entries: { url: string; size: number; unit: string }[] = []
  const pattern = /(?:^|,)\s*(\S+?)\s+(\d+(?:\.\d+)?)([wx])\s*(?=,|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    entries.push({ url: match[1], size: Number(match[2]), unit: match[3] })
  }

  if (entries.length === 0) {
    return value.split(",")[0]?.trim().split(/\s+/)[0] || null
  }

  const limit = entries[0].unit === "x" ? 2 : TARGET_IMAGE_WIDTH
  const sorted = [...entries].sort((a, b) => a.size - b.size)
  const withinLimit = sorted.filter((entry) => entry.size <= limit)
  return (withinLimit.length > 0 ? withinLimit[withinLimit.length - 1] : sorted[0]).url
}

/** First <img> on the page served from the retailer's product image CDN. */
function findFirstProductImage(html: string, platform: RetailPlatform): string | null {
  const pattern = /<img\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    const url = imageFromAttributes(parseAttributes(match[0]))
    if (!url) continue
    try {
      if (PRODUCT_IMAGE_HOSTS[platform].test(new URL(url).hostname)) return url
    } catch {
      continue
    }
  }
  return null
}

function readJsonLdProducts(html: string): LdProduct[] {
  const products: LdProduct[] = []
  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html))) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1].trim())
    } catch {
      try {
        parsed = JSON.parse(decodeHtmlEntities(match[1].trim()))
      } catch {
        continue
      }
    }
    walkLd(parsed, products, 0)
  }

  return products
}

function walkLd(node: unknown, products: LdProduct[], depth: number): void {
  if (depth > 8 || node === null || typeof node !== "object") return

  if (Array.isArray(node)) {
    for (const item of node) walkLd(item, products, depth + 1)
    return
  }

  const record = node as Record<string, unknown>
  const types = ([] as unknown[]).concat(record["@type"] ?? []).map((type) => String(type).toLowerCase())

  if (types.includes("product") || types.includes("productgroup")) {
    products.push({
      name: asText(record.name),
      url: asText(record.url) ?? asText(record["@id"]),
      brand: asText(record.brand) ?? asText((record.brand as Record<string, unknown> | undefined)?.name),
      image: firstImage(record.image),
    })
  }

  for (const key of ["@graph", "itemListElement", "mainEntity", "hasVariant"]) {
    if (key in record) walkLd(record[key], products, depth + 1)
  }
  if (record.item && typeof record.item === "object") walkLd(record.item, products, depth + 1)
}

function firstImage(value: unknown): string | null {
  if (!value) return null
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = firstImage(item)
      if (image) return image
    }
    return null
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    return asText(record.contentUrl) ?? asText(record.url)
  }
  return null
}

function pickProduct(products: LdProduct[], productId: string): LdProduct | null {
  if (products.length === 0) return null
  return products.find((product) => product.url && productId && product.url.includes(productId)) ?? products[0]
}

function pickChannelName(fileChannel: string, brand: string | null, platform: RetailPlatform): string {
  if (fileChannel && fileChannel !== "Unknown Channel") return fileChannel
  return brand || PLATFORM_LABELS[platform]
}

/** Candidate URLs for the saved page itself, most authoritative first. */
function getPageUrls(html: string): string[] {
  const urls: string[] = []

  const linkPattern = /<link\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(html))) {
    const attributes = parseAttributes(match[0])
    if ((attributes.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && attributes.href) {
      urls.push(attributes.href)
    }
  }

  const ogUrl = getMeta(html, "og:url")
  if (ogUrl) urls.push(ogUrl)

  const base = /<base\b[^>]*>/i.exec(html)?.[0]
  const baseHref = base ? parseAttributes(base).href : null
  if (baseHref) urls.push(baseHref)

  const savedFrom = /<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i.exec(html)?.[1]
  if (savedFrom) urls.push(savedFrom)

  return urls.map((url) => absoluteUrl(url)).filter((url): url is string => url !== null)
}

function getMeta(html: string, property: string): string | null {
  const pattern = /<meta\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    const attributes = parseAttributes(match[0])
    const key = (attributes.property ?? attributes.name ?? "").toLowerCase()
    if (key === property && attributes.content) return attributes.content.trim()
  }
  return null
}

function findAnchors(html: string): { href: string; attributes: Record<string, string>; inner: string }[] {
  const anchors: { href: string; attributes: Record<string, string>; inner: string }[] = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html))) {
    const attributes = parseAttributes(match[1])
    if (attributes.href) anchors.push({ href: attributes.href.trim(), attributes, inner: match[2] })
  }
  return anchors
}

/** A price such as "$76.00", "£12", "€9,99", "₦15,000" or "USD 20". */
const PRICE = /(?:[$£€₦¥]|\b(?:US\$|USD|GBP|EUR|NGN)\s?)\s?\d[\d,.]*/i

/** Words shops put next to the price in product cards. */
const PRICE_LEAD_IN = /\s+(?:now|was|from|rrp|sale|price)\s*:?\s*$/i

function cleanTitle(value: string | null | undefined): string {
  if (!value) return ""
  let title = value.replace(/\s+/g, " ").trim()

  // Product cards put the price and badges ("MORE COLOURS", "Selling fast")
  // after the name, so keep only what comes before the first price.
  const price = PRICE.exec(title)
  if (price && price.index >= 3) {
    title = title.slice(0, price.index).replace(PRICE_LEAD_IN, "").trim()
  }

  // Image descriptions end in " - view 1".
  title = title.replace(/\s+-\s+view\s+\d+$/i, "")

  return title.replace(TITLE_SUFFIX, "").trim()
}

function absoluteUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return null
  const withProtocol = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed
  try {
    const parsed = new URL(withProtocol)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null
  } catch {
    return null
  }
}

function resolveUrl(value: string, origin: string): string | null {
  const trimmed = decodeHtmlEntities(value).trim()
  if (!trimmed || /^(?:javascript|mailto|tel|data|blob):/i.test(trimmed)) return null
  try {
    return new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed, origin).toString()
  } catch {
    return null
  }
}

function originOf(url: string, platform: RetailPlatform): string | null {
  if (detectRetailHost(url) !== platform) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
