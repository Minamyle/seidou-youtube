import { parseFileName } from "../video-import/html"
import { detectRetailPage, extractRetailRecords } from "../video-import/retail"
import { detectVideoPlatform, PLATFORM_LABELS } from "../video-import/platforms"
import type { ValidationIssue } from "../video-import/validation"
import type { ProductFileResult } from "./json-file"
import type { Product } from "./types"

/**
 * Reads a shop page saved from the browser (Ctrl+S, "Webpage, HTML only") for
 * the Product Import. This is how Temu and SHEIN products are collected: their
 * sites block automated requests, but a page you opened yourself has already
 * loaded its products.
 *
 * Uses the same page reader as the video import (lib/video-import/retail.ts),
 * but keeps each product's price, which only catalogue_products can store.
 */
export function parseShopHtml(html: string, fileName: string): ProductFileResult {
  const platform = detectRetailPage(html)
  if (!platform) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message:
            "This page is not from ASOS, Temu or SHEIN. Save a product, search or category page from one of those shops and try again.",
        },
      ],
    }
  }

  const issues: ValidationIssue[] = []
  const { category, channelName } = parseFileName(fileName)
  const records = extractRetailRecords(html, platform, { category, channelName }, issues)

  if (records.length === 0) {
    return {
      ok: false,
      issues: [
        ...issues,
        {
          severity: "error",
          message: `No products were found in this ${PLATFORM_LABELS[platform]} page. Scroll until the products have loaded, then save the page again.`,
        },
      ],
    }
  }

  const products: Product[] = records.map((record) => ({
    id: detectVideoPlatform(record.videoUrl)?.externalId ?? record.videoUrl.slice(-100),
    name: record.videoTitle,
    brand: record.actualChannelName,
    price: record.price?.text ?? null,
    priceValue: record.price?.value ?? null,
    previousPrice: null,
    currency: record.price?.currency ?? null,
    description: null,
    image: record.imageUrl,
    images: [record.imageUrl],
    url: record.videoUrl,
  }))

  const withoutPrice = products.filter((product) => product.priceValue === null).length
  if (withoutPrice > 0) {
    issues.push({
      severity: "warning",
      message: `${withoutPrice} of ${products.length} product${products.length === 1 ? " has" : "s have"} no price on the saved page. Products without a price may not show in the Seidou app.`,
    })
  }

  return {
    ok: true,
    format: "page",
    products,
    sourceUrl: records[0]?.videoUrl ?? "",
    suggestedCategory: category === "Uncategorized" ? "" : category,
    issues,
  }
}
