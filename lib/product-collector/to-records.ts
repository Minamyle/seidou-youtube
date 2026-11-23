import { z } from "zod"
import type { RetailPlatform } from "../video-import/config"
import { detectRetailHost, detectVideoPlatform, PLATFORM_LABELS } from "../video-import/platforms"
import type { ValidationIssue } from "../video-import/validation"
import type { Product } from "./types"

/** Upper limits for one product import, so a single request stays small. */
export const MAX_PRODUCTS_PER_IMPORT = 500
const MAX_IMAGES_PER_PRODUCT = 12

/** A row for catalogue_products, as sent to the import_product_batch function. */
export interface ProductRecord {
  platform: RetailPlatform
  product_id: string
  product_url: string
  title: string
  image_url: string
  images: string[]
  category: string
  channel_name: string
  brand: string | null
  description: string | null
  price: number | null
  price_text: string | null
  previous_price_text: string | null
  currency: string | null
}

export interface ProductConversion {
  ok: boolean
  records: ProductRecord[]
  issues: ValidationIssue[]
  platforms: RetailPlatform[]
}

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "must be an http(s) link")

const productSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1, "has no name").max(500),
  brand: z.string().trim().max(200).nullish(),
  price: z.string().trim().max(50).nullish(),
  priceValue: z.number().finite().nonnegative().max(10_000_000).nullish(),
  previousPrice: z.string().trim().max(50).nullish(),
  currency: z.string().trim().max(10).nullish(),
  description: z.string().trim().max(5000).nullish(),
  image: httpsUrl.nullish(),
  thumbnail: httpsUrl.nullish(),
  images: z.array(z.string()).max(100).optional().default([]),
  url: httpsUrl.nullish(),
})

/**
 * Turns collected products into catalogue_products rows.
 *
 * - The shop is worked out from each product link (falling back to the page
 *   that was collected). Only ASOS, Temu and SHEIN are stored.
 * - The product ID comes from the link when it has one (/prd/<id>,
 *   -g-<id>.html, -p-<id>.html); ASOS grouped products (/grp/<id>) use the ID
 *   from the ASOS feed instead.
 * - A product needs a name and a picture; anything else is optional.
 */
export function toProductRecords(
  products: unknown,
  options: { category: string; sourceUrl: string },
): ProductConversion {
  const issues: ValidationIssue[] = []
  const category = options.category.trim()

  if (!category) {
    issues.push({ severity: "error", field: "category", message: "Enter a category for these products." })
  }

  if (!Array.isArray(products) || products.length === 0) {
    issues.push({ severity: "error", message: "There are no products to import." })
    return { ok: false, records: [], issues, platforms: [] }
  }

  if (products.length > MAX_PRODUCTS_PER_IMPORT) {
    issues.push({
      severity: "error",
      message: `${products.length} products is more than the ${MAX_PRODUCTS_PER_IMPORT} allowed in one import. Collect fewer at a time.`,
    })
    return { ok: false, records: [], issues, platforms: [] }
  }

  const sourcePlatform = safeRetailHost(options.sourceUrl)
  const records: ProductRecord[] = []
  const seen = new Set<string>()
  let skippedNoImage = 0
  let skippedOtherShop = 0
  let skippedInvalid = 0
  let duplicates = 0

  products.forEach((item, index) => {
    const parsed = productSchema.safeParse(item)
    if (!parsed.success) {
      skippedInvalid += 1
      const first = parsed.error.issues[0]
      issues.push({
        severity: "warning",
        recordIndex: index,
        message: `Product #${index + 1} was skipped: "${first.path.join(".") || "product"}" ${first.message}.`,
      })
      return
    }

    const product = parsed.data as Product
    const productUrl = product.url ?? null
    const platform = (productUrl && safeRetailHost(productUrl)) || (!productUrl ? sourcePlatform : null)

    if (!platform) {
      skippedOtherShop += 1
      return
    }

    const imageUrl = product.image ?? product.thumbnail ?? null
    if (!imageUrl) {
      skippedNoImage += 1
      return
    }

    const fromLink = productUrl ? detectVideoPlatform(productUrl) : null
    const productId = fromLink?.platform === platform ? fromLink.externalId : product.id
    const key = `${platform}:${productId}`
    if (seen.has(key)) {
      duplicates += 1
      return
    }
    seen.add(key)

    const images = [imageUrl, ...product.images]
      .filter((value, position, list) => isHttpUrl(value) && list.indexOf(value) === position)
      .slice(0, MAX_IMAGES_PER_PRODUCT)

    records.push({
      platform,
      product_id: productId,
      product_url: productUrl ?? options.sourceUrl,
      title: product.name.trim(),
      image_url: imageUrl,
      images,
      category,
      channel_name: PLATFORM_LABELS[platform],
      brand: product.brand?.trim() || null,
      description: product.description?.trim() || null,
      price: product.priceValue ?? null,
      price_text: product.price?.trim() || null,
      previous_price_text: product.previousPrice?.trim() || null,
      currency: product.currency?.trim().toUpperCase() || null,
    })
  })

  if (skippedOtherShop > 0) {
    issues.push({
      severity: "warning",
      message: `${skippedOtherShop} product${skippedOtherShop === 1 ? " is" : "s are"} not from ASOS, Temu or SHEIN and will not be imported.`,
    })
  }
  if (skippedNoImage > 0) {
    issues.push({
      severity: "warning",
      message: `${skippedNoImage} product${skippedNoImage === 1 ? " has" : "s have"} no picture and will not be imported.`,
    })
  }
  if (duplicates > 0) {
    issues.push({
      severity: "warning",
      message: `${duplicates} product${duplicates === 1 ? " appears" : "s appear"} more than once and will be imported once.`,
    })
  }
  if (records.length === 0 && skippedInvalid + skippedOtherShop + skippedNoImage + duplicates > 0) {
    issues.push({ severity: "error", message: "None of these products can be imported." })
  }

  const platforms = [...new Set(records.map((record) => record.platform))]

  return {
    ok: issues.every((issue) => issue.severity !== "error") && records.length > 0,
    records,
    issues,
    platforms,
  }
}

function safeRetailHost(url: string): RetailPlatform | null {
  try {
    return detectRetailHost(new URL(url).toString())
  } catch {
    return null
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}
