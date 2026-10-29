import { HTML_FILE_MAX_BYTES, type VideoPlatform } from "./config"
import { detectVideoPlatform } from "./platforms"
import type { ValidationIssue } from "./validation"

export interface HtmlVideoRecord {
  category: string
  channelName: string
  videoUrl: string
  videoTitle: string
  platform: VideoPlatform
  actualChannelName: string | null
  isUnrelatedChannel: boolean
}

export interface HtmlImportResult {
  ok: boolean
  records: HtmlVideoRecord[]
  issues: ValidationIssue[]
  xCount: number
  youtubeCount: number
}

export type HtmlReadResult =
  | { ok: true; text: string; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] }

const X_STATUS_PATTERN =
  /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/web\/|([^/?#"'<>]+)\/)?status(?:es)?\/(\d+)/i

const X_RELATIVE_STATUS_PATTERN = /^\/(?:i\/web\/|([^/?#"'<>]+)\/)?status(?:es)?\/(\d+)/i

const VIDEO_MARKER_PATTERN =
  /data-testid="videoPlayer"|<video\b|data-testid="videoComponent"|aria-label="Play/i

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
])

const GENERIC_YOUTUBE_TITLES = new Set([
  "watch",
  "watch later",
  "play",
  "share",
  "shorts",
  "video",
  "youtube",
  "youtube video",
])

const YOUTUBE_TITLE_NOISE = /(?:•|\bviews?\b|\bago\b|\bplaylist\b|\bsubscribe\b|\bshare\b)/i

export function parseFileName(fileName: string): { category: string; channelName: string } {
  const base = fileName.replace(/\.(?:json|html?)$/i, "")
  const parts = base.split(",").map((part) => part.trim())

  const category = parts[0] || "Uncategorized"
  const channelName = cleanChannelName(parts[1] || "") || "Unknown Channel"

  return { category, channelName }
}

export async function readHtmlFile(file: File | null | undefined): Promise<HtmlReadResult> {
  if (!file) {
    return {
      ok: false,
      issues: [{ severity: "error", message: "No HTML file selected. Choose an .html file saved from X or a video page." }],
    }
  }

  const issues: ValidationIssue[] = []

  if (file.size === 0) {
    return {
      ok: false,
      issues: [{ severity: "error", message: `"${file.name}" is empty (0 bytes). Save the page again and retry.` }],
    }
  }

  if (file.size > HTML_FILE_MAX_BYTES) {
    const maxMb = Math.round(HTML_FILE_MAX_BYTES / (1024 * 1024))
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message: `"${file.name}" is ${formatBytes(file.size)}, which is larger than the ${maxMb} MB HTML limit. Save a smaller page or split it.`,
        },
      ],
    }
  }

  if (!/\.html?$/i.test(file.name)) {
    issues.push({
      severity: "warning",
      message: `"${file.name}" does not have an .html extension. The content is parsed anyway.`,
    })
  }

  try {
    const text = await file.text()
    return { ok: true, text, issues }
  } catch {
    return {
      ok: false,
      issues: [{ severity: "error", message: `"${file.name}" could not be read. Try selecting the file again.` }],
    }
  }
}

export function parseHtmlImport(html: string, fileName: string): HtmlImportResult {
  const issues: ValidationIssue[] = []

  const xPage = looksLikeXPage(html)
  const xRecords = extractXRecords(html, fileName, issues)
  const youtubeRecords = xPage ? [] : extractYouTubeRecords(html, fileName)
  const records = [...xRecords, ...youtubeRecords]

  if (records.length === 0) {
    issues.push(
      xPage
        ? {
            severity: "error",
            message:
              "This looks like an X (Twitter) page, but no X video posts were found in it. Open the page, scroll until the videos are loaded, then save it again as HTML.",
          }
        : {
            severity: "error",
            message:
              "No YouTube or X (Twitter) video links were found in this HTML file. Open the page, scroll until the videos are loaded, then save it again as HTML.",
          },
    )
  }

  return {
    ok: records.length > 0,
    records,
    issues,
    xCount: xRecords.length,
    youtubeCount: youtubeRecords.length,
  }
}

/**
 * A saved X page should only yield X posts. Without this check, YouTube links
 * quoted inside tweets (or in page scripts) would be imported as YouTube videos.
 */
function looksLikeXPage(html: string): boolean {
  return (
    /data-testid="(?:tweetText|tweet|videoPlayer)"/i.test(html) ||
    /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^"'\s<>]*\/status(?:es)?\/\d+/i.test(html) ||
    /href="\/(?:i\/web\/|[^"'\s<>/]+\/)status(?:es)?\/\d+/i.test(html)
  )
}

/**
 * Status links can be absolute or relative depending on how the browser saved
 * the page. Relative links are only read from href attributes so unrelated
 * "/status/123" paths elsewhere in the document are ignored.
 */
function findXStatus(container: string): { handle: string | null; id: string } | null {
  const absolute = X_STATUS_PATTERN.exec(container)
  if (absolute) {
    return { handle: absolute[1] ?? null, id: absolute[2] }
  }

  const hrefPattern = /href="([^"]+)"/gi
  let match: RegExpExecArray | null

  while ((match = hrefPattern.exec(container))) {
    const href = decodeHtmlEntities(match[1]).trim()
    if (!href.startsWith("/")) continue

    const relative = X_RELATIVE_STATUS_PATTERN.exec(href)
    if (relative) {
      return { handle: relative[1] ?? null, id: relative[2] }
    }
  }

  return null
}

function extractXRecords(
  html: string,
  fileName: string,
  issues: ValidationIssue[],
): HtmlVideoRecord[] {
  const { category, channelName: fileChannel } = parseFileName(fileName)
  const articles = extractElements(html, "article")
  const containers = articles.length > 0 ? articles : buildFallbackContainers(html)

  interface Candidate {
    id: string
    handle: string | null
    title: string
    hasVideo: boolean
  }

  const candidates: Candidate[] = []

  for (const container of containers) {
    const status = findXStatus(container)
    if (!status) continue

    const { handle, id } = status
    const hasVideo = VIDEO_MARKER_PATTERN.test(container)
    const tweetTextHtml = extractDivByTestId(container, "tweetText")
    const tweetText = tweetTextHtml ? cleanText(stripHtml(tweetTextHtml)) : ""
    const date = /<time[^>]*datetime="([^"]+)"/i.exec(container)?.[1] ?? null

    const fallbackTitle = date ? `X video post - ${date.slice(0, 10)}` : `X video post ${id}`
    const title = truncate(tweetText || fallbackTitle)

    candidates.push({ id, handle, title, hasVideo })
  }

  if (candidates.length === 0) return []

  const videoCandidates = candidates.filter((candidate) => candidate.hasVideo)
  const chosen = videoCandidates.length > 0 ? videoCandidates : candidates

  if (videoCandidates.length === 0) {
    issues.push({
      severity: "warning",
      message:
        "Could not detect which X posts contain video, so every X post found in the file was included. Remove any text-only posts from the JSON if needed.",
    })
  } else if (candidates.length > videoCandidates.length) {
    issues.push({
      severity: "warning",
      message: `${candidates.length - videoCandidates.length} X post${candidates.length - videoCandidates.length === 1 ? " was" : "s were"} skipped because no video was detected in ${candidates.length - videoCandidates.length === 1 ? "it" : "them"}.`,
    })
  }

  const seen = new Set<string>()
  const records: HtmlVideoRecord[] = []

  for (const candidate of chosen) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)

    const handle = candidate.handle && candidate.handle.toLowerCase() !== "i" ? candidate.handle : null
    const channelName =
      fileChannel !== "Unknown Channel" ? fileChannel : handle ? `@${handle}` : "Unknown Channel"
    const actualChannelName = handle ?? (fileChannel !== "Unknown Channel" ? fileChannel : null)
    const videoUrl = handle
      ? `https://x.com/${handle}/status/${candidate.id}`
      : `https://x.com/i/web/status/${candidate.id}`

    records.push({
      category,
      channelName,
      videoUrl,
      videoTitle: candidate.title,
      platform: "x",
      actualChannelName,
      isUnrelatedChannel: false,
    })
  }

  return records
}

function extractYouTubeRecords(html: string, fileName: string): HtmlVideoRecord[] {
  const { category, channelName } = parseFileName(fileName)
  const records: HtmlVideoRecord[] = []
  const indexByUrl = new Map<string, number>()

  const linkPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = linkPattern.exec(html))) {
    if (isInsideAdBlock(html, match.index)) continue

    const href = decodeHtmlEntities(match[1])
    const anchorText = cleanYouTubeTitle(stripHtml(match[2]))

    let candidateUrl: string | null = null
    let title = anchorText

    if (isYouTubeRedirect(href)) {
      const rurl = /[?&]rurl=([^&]+)/.exec(href)?.[1]
      const tit = /[?&]tit=([^&]+)/.exec(href)?.[1]

      if (rurl) {
        candidateUrl = safeDecode(rurl)
      }

      if (tit) {
        title = cleanYouTubeTitle(safeDecode(tit).replace(/\+/g, " "))
      }
    } else if (isYouTubeHost(href)) {
      candidateUrl = href
    }

    if (!candidateUrl) continue

    const detected = detectVideoPlatform(candidateUrl)
    if (!detected || detected.platform !== "youtube") continue

    const videoUrl = `https://www.youtube.com/watch?v=${detected.externalId}`
    const existingIndex = indexByUrl.get(videoUrl)

    if (existingIndex !== undefined) {
      const existing = records[existingIndex]
      if (isBetterTitle(title, String(existing.videoTitle ?? ""))) {
        existing.videoTitle = truncate(title)
      }
      continue
    }

    indexByUrl.set(videoUrl, records.length)
    records.push({
      category,
      channelName,
      videoUrl,
      videoTitle: truncate(title || `YouTube video ${detected.externalId}`),
      platform: "youtube",
      actualChannelName: channelName,
      isUnrelatedChannel: false,
    })
  }

  return records
}

function isYouTubeHost(href: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(href).hostname.toLowerCase())
  } catch {
    return false
  }
}

function isYouTubeRedirect(href: string): boolean {
  try {
    const url = new URL(href)
    return YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) && url.pathname.startsWith("/redirect")
  } catch {
    return false
  }
}

/**
 * Saved pages often link the same video twice: once from the thumbnail (with a
 * generic "Watch" label) and once from the real title. Keep the useful one.
 */
function isBetterTitle(candidate: string, current: string): boolean {
  const next = cleanYouTubeTitle(candidate)
  const prev = cleanYouTubeTitle(current)

  if (!next) return false
  if (!prev) return true

  const nextQuality = titleQuality(next)
  const prevQuality = titleQuality(prev)

  if (nextQuality !== prevQuality) return nextQuality > prevQuality

  return next.length > prev.length
}

function titleQuality(title: string): number {
  if (GENERIC_YOUTUBE_TITLES.has(title.toLowerCase())) return 0
  if (YOUTUBE_TITLE_NOISE.test(title)) return 1
  return 2
}

/**
 * YouTube search pages include promoted videos whose only real link is an ad
 * button. Those videos have no useful title in the saved HTML, so skip them.
 */
function isInsideAdBlock(html: string, index: number): boolean {
  const context = html.slice(Math.max(0, index - 300), index)
  return /<ad-button-view-model\b|ytwAdButtonGroupViewModelHost/i.test(context)
}

/**
 * If the saved page has no <article> elements, scan every status link and use a
 * window of surrounding HTML so title and video detection still work.
 */
function buildFallbackContainers(html: string): string[] {
  const pattern = new RegExp(X_STATUS_PATTERN.source, "gi")
  const containers: string[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(html))) {
    const index = match.index
    const start = Math.max(0, index - 3000)
    const end = Math.min(html.length, index + 6000)
    containers.push(html.slice(start, end))
  }

  return containers
}

function extractElements(html: string, tagName: string): string[] {
  const results: string[] = []
  const openPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi")
  let match: RegExpExecArray | null

  while ((match = openPattern.exec(html))) {
    const openEnd = match.index + match[0].length
    const tagPattern = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, "gi")
    tagPattern.lastIndex = openEnd

    let depth = 1
    let inner: RegExpExecArray | null
    let closed = false

    while ((inner = tagPattern.exec(html))) {
      if (inner[0].startsWith("</")) {
        depth -= 1
      } else {
        depth += 1
      }

      if (depth === 0) {
        results.push(html.slice(openEnd, inner.index))
        openPattern.lastIndex = inner.index + inner[0].length
        closed = true
        break
      }
    }

    if (!closed) break
  }

  return results
}

function extractDivByTestId(html: string, testId: string): string | null {
  const openPattern = new RegExp(`<div\\b[^>]*data-testid="${escapeRegExp(testId)}"[^>]*>`, "i")
  const match = openPattern.exec(html)
  if (!match) return null

  const openEnd = match.index + match[0].length
  const tagPattern = /<div\b[^>]*>|<\/div>/gi
  tagPattern.lastIndex = openEnd

  let depth = 1
  let inner: RegExpExecArray | null

  while ((inner = tagPattern.exec(html))) {
    if (inner[0].startsWith("</")) {
      depth -= 1
    } else {
      depth += 1
    }

    if (depth === 0) {
      return html.slice(openEnd, inner.index)
    }
  }

  return null
}

function cleanChannelName(value: string): string {
  let channel = value.trim()

  channel = channel.replace(/\s*[_|/-]\s*(?:x|twitter)\s*$/i, "")
  channel = channel.replace(/\s*\((?:x|twitter)\)\s*$/i, "")
  channel = channel.replace(/\s*[-–—]\s*(?:x|twitter)\s*$/i, "")

  if (/^\(.*\)$/.test(channel)) {
    channel = channel.slice(1, -1)
  }

  return channel.trim()
}

function cleanText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*https?:\/\/t\.co\/\S+/gi, "")
    .replace(/\s*t\.co\/\S+/gi, "")
    .trim()
}

function cleanYouTubeTitle(value: string): string {
  let cleaned = cleanText(value)

  cleaned = cleaned.replace(/^\d+:\d+(:\d+)?/, "").trim()
  cleaned = cleaned.replace(/\d+\.?\d*[KM]?\s*views?.*$/i, "").trim()
  cleaned = cleaned.replace(/YouTube.*$/i, "").trim()
  cleaned = cleaned.replace(/www\.youtube\.com.*$/i, "").trim()
  cleaned = cleaned.replace(/Share feedback.*$/i, "").trim()
  cleaned = cleaned.replace(/^\d{1,2}[.)]\s+/, "").trim()

  return cleaned
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x"
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : full
    }

    return HTML_ENTITY_MAP[entity.toLowerCase()] ?? full
  })
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function truncate(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
