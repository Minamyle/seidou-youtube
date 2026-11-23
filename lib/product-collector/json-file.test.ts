import { describe, expect, it } from "vitest"
import { parseProductFile } from "./json-file"
import { toProductRecords } from "./to-records"

const collectorProduct = {
  id: "211969666",
  name: "Mango co-ord in black",
  brand: "Mango",
  price: "£49.99",
  priceValue: 49.99,
  previousPrice: null,
  currency: "GBP",
  description: "Mango co-ord in black",
  image: "https://images.asos-media.com/products/mango/211969666-1-black?$n_1920w$&wid=1926",
  images: ["https://images.asos-media.com/products/mango/211969666-1-black?$n_1920w$&wid=1926"],
  url: "https://www.asos.com/mango/mango-co-ord/grp/212145573",
}

const libraryRecord = {
  category: "Shop Women's ASOS",
  channelName: "ASOS",
  videoUrl: "https://www.asos.com/asos-design/belt/prd/205116643",
  videoTitle: "ASOS DESIGN jeans belt in black",
  platform: "asos",
  imageUrl: "https://images.asos-media.com/products/belt/205116643-1-black?$n_960w$&wid=952",
}

describe("parseProductFile", () => {
  it("reads the Product Collector's products.json", () => {
    const result = parseProductFile({
      source: "https://www.asos.com/women/mango/cat/?cid=8264",
      title: "Mango",
      total: 2927,
      count: 1,
      products: [collectorProduct],
    })

    expect(result).toMatchObject({
      ok: true,
      format: "collector",
      sourceUrl: "https://www.asos.com/women/mango/cat/?cid=8264",
      suggestedCategory: "Mango",
    })
    if (!result.ok) return
    expect(result.products).toHaveLength(1)
    expect(toProductRecords(result.products, { category: "Mango", sourceUrl: result.sourceUrl }).ok).toBe(true)
  })

  it("reads a bare array of collected products", () => {
    const result = parseProductFile([collectorProduct])
    expect(result).toMatchObject({ ok: true, format: "collector" })
  })

  it("reads a video library export, keeping only shop products", () => {
    const result = parseProductFile([
      libraryRecord,
      { ...libraryRecord, videoUrl: "https://www.youtube.com/watch?v=3Iyuym-Gci0", platform: "youtube", imageUrl: undefined },
      { ...libraryRecord, videoUrl: "https://example.com/not-a-shop" },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format).toBe("library")
    expect(result.suggestedCategory).toBe("Shop Women's ASOS")
    expect(result.products).toEqual([
      {
        id: "205116643",
        name: "ASOS DESIGN jeans belt in black",
        brand: null,
        price: null,
        priceValue: null,
        previousPrice: null,
        currency: null,
        description: null,
        image: libraryRecord.imageUrl,
        images: [libraryRecord.imageUrl],
        url: libraryRecord.videoUrl,
      },
    ])
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "Record #3 has no ASOS, Temu or SHEIN product link and was skipped.",
      "1 YouTube/X video record was ignored. Import videos with the JSON Video Import Form.",
    ])

    const records = toProductRecords(result.products, { category: result.suggestedCategory, sourceUrl: "" })
    expect(records.ok).toBe(true)
    expect(records.records[0]).toMatchObject({ platform: "asos", product_id: "205116643", channel_name: "ASOS" })
  })

  it("suggests the most common category and warns when there are several", () => {
    const result = parseProductFile([
      libraryRecord,
      { ...libraryRecord, videoUrl: "https://www.asos.com/x/prd/205116644", category: "Shop Women's ASOS" },
      { ...libraryRecord, videoUrl: "https://www.asos.com/x/prd/205116645", category: "Shoes" },
    ])
    expect(result.ok && result.suggestedCategory).toBe("Shop Women's ASOS")
    expect(result.ok && result.issues.at(-1)?.message).toContain("2 categories")
  })

  it("rejects a library export with only videos", () => {
    const result = parseProductFile([
      { ...libraryRecord, videoUrl: "https://www.youtube.com/watch?v=3Iyuym-Gci0", platform: "youtube" },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues.at(-1)?.message).toBe("The file has no ASOS, Temu or SHEIN products.")
  })

  it.each([
    [{ hello: "world" }, "not a product list"],
    ["text", "not a product list"],
    [[], "no products"],
  ])("rejects %j", (input, message) => {
    const result = parseProductFile(input)
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain(message)
  })
})
