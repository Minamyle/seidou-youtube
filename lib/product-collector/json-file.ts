import { detectVideoPlatform, isRetailPlatform } from "../video-import/platforms"
import type { ValidationIssue } from "../video-import/validation"
import type { Product } from "./types"

/**
 * Reads a product JSON file. Two shapes are accepted:
 *
 *   collector  The Product Collector's products.json: { source, title, products: [...] }
 *              (or just the products array).
 *   library    The home page's "Export JSON": [{ category, channelName, videoUrl,
 *              videoTitle, platform, imageUrl }, ...]. Only ASOS/Temu/SHEIN records
 *              are used; YouTube and X records belong on the video import form.
 *
 * Both are turned into collector products, so they go through the same
 * checks (toProductRecords) and database function as collected products.
 */

export interface ProductFile {
  format: "collector" | "library"
  products: Product[]
  /** The shop page the products came from, when the file says. */
  sourceUrl: string
  /** Category to start the form with: the collector's page title, or the records' category. */
  suggestedCategory: string
  issues: ValidationIssue[]
}

export type ProductFileResult = ({ ok: true } & ProductFile) | { ok: false; issues: ValidationIssue[] }

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null)

export function parseProductFile(parsed: unknown): ProductFileResult {
  if (isObject(parsed) && Array.isArray(parsed.products)) {
    return {
      ok: true,
      format: "collector",
      products: parsed.products as Product[],
      sourceUrl: text(parsed.source) ?? "",
      suggestedCategory: text(parsed.title) ?? "",
      issues: [],
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message:
            "This file is not a product list. Use products.json from the Product Collector, or a video library export with ASOS, Temu or SHEIN records.",
        },
      ],
    }
  }

  if (parsed.length === 0) {
    return { ok: false, issues: [{ severity: "error", message: "The file contains no products." }] }
  }

  const looksLikeLibrary = parsed.some((item) => isObject(item) && "videoUrl" in item)
  if (!looksLikeLibrary) {
    return { ok: true, format: "collector", products: parsed as Product[], sourceUrl: "", suggestedCategory: "", issues: [] }
  }

  return fromLibraryRecords(parsed)
}

function fromLibraryRecords(records: unknown[]): ProductFileResult {
  const issues: ValidationIssue[] = []
  const products: Product[] = []
  const categories = new Map<string, number>()
  let videoRecords = 0

  records.forEach((record, index) => {
    if (!isObject(record)) return
    const videoUrl = text(record.videoUrl)
    const detected = videoUrl ? detectVideoPlatform(videoUrl) : null

    if (!detected || !isRetailPlatform(detected.platform)) {
      if (detected) videoRecords += 1
      else issues.push({ severity: "warning", recordIndex: index, message: `Record #${index + 1} has no ASOS, Temu or SHEIN product link and was skipped.` })
      return
    }

    const imageUrl = text(record.imageUrl)
    const category = text(record.category)
    if (category) categories.set(category, (categories.get(category) ?? 0) + 1)

    products.push({
      id: detected.externalId,
      name: text(record.videoTitle) ?? "",
      brand: text(record.actualChannelName),
      price: null,
      priceValue: null,
      previousPrice: null,
      currency: null,
      description: null,
      image: imageUrl,
      images: imageUrl ? [imageUrl] : [],
      url: videoUrl,
    })
  })

  if (videoRecords > 0) {
    issues.push({
      severity: "warning",
      message: `${videoRecords} YouTube/X video record${videoRecords === 1 ? " was" : "s were"} ignored. Import videos with the JSON Video Import Form.`,
    })
  }

  if (products.length === 0) {
    return {
      ok: false,
      issues: [...issues, { severity: "error", message: "The file has no ASOS, Temu or SHEIN products." }],
    }
  }

  const suggestedCategory = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
  if (categories.size > 1) {
    issues.push({
      severity: "warning",
      message: `The file has ${categories.size} categories. All products are imported under the category you set below.`,
    })
  }

  return { ok: true, format: "library", products, sourceUrl: "", suggestedCategory, issues }
}
