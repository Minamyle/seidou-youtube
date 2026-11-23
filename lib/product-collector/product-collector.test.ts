import { afterEach, describe, expect, it, vi } from "vitest"
import { scrapeAsos } from "./asos"
import { isCollectableUrl } from "./safety"
import { toProductRecords } from "./to-records"
import type { Product } from "./types"

// Shaped like a real item from the ASOS category feed (cid 8264, Mango).
const asosItem = {
  id: 211969666,
  name: "Mango Premium Party Collection Elio tailored mini short co-ord in black",
  brandName: "Mango",
  colour: "BLACK",
  url: "mango/mango-premium-party-collection-elio-tux-blazer-mini-short-co-ord-in-black/grp/212145573#colourWayId-211969669&productId-211969666",
  imageUrl: "images.asos-media.com/products/mango-premium-party-collection-elio-tailored-mini-short-co-ord-in-black/211969666-1-black",
  additionalImageUrls: ["images.asos-media.com/products/mango-elio/211969666-2"],
  price: { currency: "GBP", current: { value: 49.99, text: "£49.99" }, previous: { value: null, text: "" } },
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "211969666",
    name: "Mango co-ord in black",
    brand: "Mango",
    price: "£49.99",
    priceValue: 49.99,
    previousPrice: null,
    currency: "GBP",
    description: "Mango co-ord in black. Colour: black. Brand: Mango",
    image: "https://images.asos-media.com/products/mango/211969666-1-black?$n_1920w$&wid=1926&fit=constrain&qlt=90",
    thumbnail: "https://images.asos-media.com/products/mango/211969666-1-black?$n_640w$&wid=640&fit=constrain&qlt=90",
    images: ["https://images.asos-media.com/products/mango/211969666-1-black?$n_1920w$&wid=1926&fit=constrain&qlt=90"],
    url: "https://www.asos.com/mango/mango-co-ord/grp/212145573",
    ...overrides,
  }
}

const source = "https://www.asos.com/women/a-to-z-of-brands/mango/cat/?cid=8264"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("scrapeAsos", () => {
  it("maps the ASOS category feed to products with large pictures", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ categoryName: "Mango", itemCount: 2927, products: [asosItem] }), {
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await scrapeAsos(new URL(source), 48, 0, false)

    const requested = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))
    expect(requested.pathname).toBe("/api/product/search/v2/categories/8264")
    expect(requested.searchParams.get("limit")).toBe("48")
    expect(result).toMatchObject({ title: "Mango", total: 2927, count: 1 })
    expect(result.products[0]).toMatchObject({
      id: "211969666",
      brand: "Mango",
      price: "£49.99",
      priceValue: 49.99,
      currency: "GBP",
      url: "https://www.asos.com/mango/mango-premium-party-collection-elio-tux-blazer-mini-short-co-ord-in-black/grp/212145573",
      image:
        "https://images.asos-media.com/products/mango-premium-party-collection-elio-tailored-mini-short-co-ord-in-black/211969666-1-black?$n_1920w$&wid=1926&fit=constrain&qlt=90",
    })
    expect(result.products[0].images).toHaveLength(2)
  })

  it("explains a link without a category id", async () => {
    await expect(scrapeAsos(new URL("https://www.asos.com/women/"), 48, 0, false)).rejects.toThrow("category id")
  })
})

describe("toProductRecords", () => {
  it("builds a catalogue_products row from a collected ASOS product", () => {
    const result = toProductRecords([product()], { category: "Mango", sourceUrl: source })

    expect(result.ok).toBe(true)
    expect(result.platforms).toEqual(["asos"])
    expect(result.records).toEqual([
      {
        platform: "asos",
        product_id: "211969666", // /grp/ links carry a group id, so the feed id is used
        product_url: "https://www.asos.com/mango/mango-co-ord/grp/212145573",
        title: "Mango co-ord in black",
        image_url: product().image,
        images: [product().image],
        category: "Mango",
        channel_name: "ASOS",
        brand: "Mango",
        description: "Mango co-ord in black. Colour: black. Brand: Mango",
        price: 49.99,
        price_text: "£49.99",
        previous_price_text: null,
        currency: "GBP",
      },
    ])
  })

  it("takes the product id from a /prd/ link when there is one", () => {
    const result = toProductRecords([product({ id: "0", url: "https://www.asos.com/mango/dress/prd/209067828" })], {
      category: "Mango",
      sourceUrl: source,
    })
    expect(result.records[0].product_id).toBe("209067828")
  })

  it("skips products without a picture, from other shops, or repeated", () => {
    const result = toProductRecords(
      [
        product(),
        product({ id: "2", image: null, thumbnail: null, images: [] }),
        product({ id: "3", url: "https://shop.example.com/item/3" }),
        product(),
      ],
      { category: "Mango", sourceUrl: source },
    )

    expect(result.ok).toBe(true)
    expect(result.records).toHaveLength(1)
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "1 product is not from ASOS, Temu or SHEIN and will not be imported.",
      "1 product has no picture and will not be imported.",
      "1 product appears more than once and will be imported once.",
    ])
  })

  it("requires a category", () => {
    const result = toProductRecords([product()], { category: "  ", sourceUrl: source })
    expect(result.ok).toBe(false)
    expect(result.issues[0].field).toBe("category")
  })

  it("fails when nothing can be imported", () => {
    const result = toProductRecords([product({ url: "https://shop.example.com/a" })], {
      category: "x",
      sourceUrl: "https://shop.example.com/",
    })
    expect(result.ok).toBe(false)
    expect(result.issues.at(-1)?.message).toBe("None of these products can be imported.")
  })

  it("rejects input that is not a list of products", () => {
    expect(toProductRecords({ products: [] }, { category: "x", sourceUrl: source }).ok).toBe(false)
  })
})

describe("isCollectableUrl", () => {
  it.each(["https://www.asos.com/women/cat/?cid=8264", "http://shop.example.com/products"])("allows %s", (url) => {
    expect(isCollectableUrl(new URL(url))).toBe(true)
  })

  it.each([
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.20.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://2130706433/",
    "http://user:pass@shop.example.com/",
    "ftp://shop.example.com/",
  ])("blocks %s", (url) => {
    expect(isCollectableUrl(new URL(url))).toBe(false)
  })
})
