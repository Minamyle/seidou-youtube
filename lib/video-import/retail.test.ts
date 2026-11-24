import { describe, expect, it } from "vitest"
import { parseHtmlImport } from "./html"
import { canonicalRetailUrl, detectVideoPlatform, isProductBatch } from "./platforms"
import { pickFromSrcset } from "./retail"
import { validateVideoRecords } from "./validation"

const TEMU_IMAGE = "https://img.kwcdn.com/product/fancy/case.jpg"

function page({ head = "", body = "" }: { head?: string; body?: string }) {
  return `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`
}

function jsonLd(value: unknown) {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`
}

describe("detectVideoPlatform for retail product pages", () => {
  it.each([
    ["https://www.asos.com/asos-design/asos-design-oversized-t-shirt/prd/210636221", "asos", "210636221"],
    ["https://www.asos.com/us/asos-design/shirt/prd/210636221?clr=black&colourWayId=1", "asos", "210636221"],
    ["https://www.asos.com/pgeproduct.aspx?productid=1234567", "asos", "1234567"],
    ["https://www.temu.com/goods.html?goods_id=601099512345", "temu", "601099512345"],
    ["https://www.temu.com/uk/phone-case-g-601101955527840.html?_x_sessn_id=abc", "temu", "601101955527840"],
    ["https://us.shein.com/product-p-515174062.html", "shein", "515174062"],
    ["https://www.shein.co.uk/Floral-Dress-p-12345678-cat-1727.html?src=list", "shein", "12345678"],
  ])("detects %s", (url, platform, externalId) => {
    expect(detectVideoPlatform(url)).toEqual({ platform, externalId })
  })

  it.each([
    "https://www.temu.com/",
    "https://www.temu.com/search_result.html?search_key=phone%20case",
    "https://us.shein.com/women-dresses-c-1727.html",
    "https://www.asos.com/women/",
    "https://notasos.com/prd/210636221",
    "https://temu.com.evil.example/goods.html?goods_id=601099512345",
  ])("rejects non-product or look-alike URL %s", (url) => {
    expect(detectVideoPlatform(url)).toBeNull()
  })

  it("still detects YouTube and X links", () => {
    expect(detectVideoPlatform("https://youtu.be/3Iyuym-Gci0")?.platform).toBe("youtube")
    expect(detectVideoPlatform("https://x.com/davido/status/123")?.platform).toBe("x")
  })
})

describe("canonicalRetailUrl", () => {
  it("drops tracking parameters and fragments when the ID is in the path", () => {
    expect(canonicalRetailUrl("http://www.temu.com/uk/case-g-601101955527840.html?refer_page=x#top")).toBe(
      "https://www.temu.com/uk/case-g-601101955527840.html",
    )
  })

  it("keeps only the ID parameter when the ID is in the query", () => {
    expect(canonicalRetailUrl("https://www.temu.com/goods.html?foo=1&goods_id=601099512345&bar=2")).toBe(
      "https://www.temu.com/goods.html?goods_id=601099512345",
    )
  })
})

describe("validateVideoRecords for retail records", () => {
  const base = {
    category: "Gadgets",
    channelName: "Temu",
    videoTitle: "Phone case",
    videoUrl: "https://www.temu.com/uk/phone-case-g-601101955527840.html",
    imageUrl: TEMU_IMAGE,
  }

  it("accepts a product page with its picture", () => {
    const result = validateVideoRecords([{ ...base, platform: "temu" }])

    expect(result.ok).toBe(true)
    expect(result.records[0]).toMatchObject({
      platform: "temu",
      externalId: "601101955527840",
      imageUrl: TEMU_IMAGE,
    })
    expect(result.platformCounts.temu).toBe(1)
    expect(result.issues.some((issue) => issue.message.includes("Unrecognized"))).toBe(false)
  })

  it("accepts ASOS image URLs that have no file extension", () => {
    const result = validateVideoRecords([
      {
        ...base,
        videoUrl: "https://www.asos.com/asos-design/jeans/prd/210636221",
        imageUrl: "https://images.asos-media.com/products/jeans/210636221-1-grey?$n_640w$",
      },
    ])
    expect(result.ok).toBe(true)
  })

  it("rejects a product without a picture", () => {
    const { imageUrl: _ignored, ...withoutImage } = base
    const result = validateVideoRecords([withoutImage])
    expect(result.ok).toBe(false)
    expect(result.issues[0].field).toBe("imageUrl")
    expect(result.issues[0].message).toContain("required for Temu")
  })

  it("rejects an imageUrl that is not a web link", () => {
    const result = validateVideoRecords([{ ...base, imageUrl: "case.jpg" }])
    expect(result.ok).toBe(false)
    expect(result.issues[0].field).toBe("imageUrl")
  })

  it("rejects imageUrl on a YouTube record", () => {
    const result = validateVideoRecords([{ ...base, videoUrl: "https://www.youtube.com/watch?v=3Iyuym-Gci0" }])
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("only used for ASOS, Temu and SHEIN")
  })

  it("de-duplicates the same product even when the URL differs", () => {
    const result = validateVideoRecords([base, { ...base, videoUrl: "https://www.temu.com/goods.html?goods_id=601101955527840" }])
    expect(result.records).toHaveLength(1)
    expect(result.duplicateCount).toBe(1)
  })

  it("rejects a platform that conflicts with the product URL", () => {
    const result = validateVideoRecords([{ ...base, platform: "shein" }])
    expect(result.ok).toBe(false)
    expect(result.issues[0].field).toBe("platform")
  })

  it("rejects a retailer link that is not a product page", () => {
    const result = validateVideoRecords([{ ...base, videoUrl: "https://www.temu.com/search_result.html?search_key=x" }])
    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("product page")
  })
})

describe("retail page detection", () => {
  const temuLinks = ["601000000001", "601000000002", "601000000003"]
    .map((id) => `<a href="https://www.temu.com/uk/item-g-${id}.html"><img src="https://img.kwcdn.com/${id}.jpg" alt="Item ${id}"></a>`)
    .join("")

  it("treats a page without its own URL but with several product links as a listing", () => {
    const result = parseHtmlImport(page({ body: temuLinks }), "Deals.html")
    expect(result.counts.temu).toBe(3)
  })

  it("does not treat an X page with shared shop links as a retailer page", () => {
    const html = page({
      head: `<link rel="canonical" href="https://x.com/someone">`,
      body: `<article><a href="https://x.com/someone/status/1234567890123456789">post</a><div data-testid="videoPlayer"></div>${temuLinks}</article>`,
    })
    const result = parseHtmlImport(html, "Deals , (@someone) _ X.html")
    expect(result.counts.temu).toBe(0)
    expect(result.xCount).toBe(1)
  })
})

describe("parseHtmlImport for a product page", () => {
  it("imports a Temu product with its og:image, ignoring a YouTube link in the footer", () => {
    const html = page({
      head: `<link rel="canonical" href="https://www.temu.com/uk/phone-case-g-601101955527840.html">
        <title>Clear Phone Case - Temu United Kingdom</title>
        <meta property="og:image" content="${TEMU_IMAGE}">`,
      body: `<a href="https://www.youtube.com/watch?v=3Iyuym-Gci0">Temu on YouTube</a>`,
    })

    const result = parseHtmlImport(html, "Gadgets, Temu.html")

    expect(result.ok).toBe(true)
    expect(result.records).toEqual([
      {
        category: "Gadgets",
        channelName: "Temu",
        videoUrl: "https://www.temu.com/uk/phone-case-g-601101955527840.html",
        videoTitle: "Clear Phone Case",
        platform: "temu",
        actualChannelName: null,
        isUnrelatedChannel: false,
        imageUrl: TEMU_IMAGE,
      },
    ])
    expect(result.counts.temu).toBe(1)
    expect(result.youtubeCount).toBe(0)
    expect(result.issues).toEqual([])
  })

  it("prefers the JSON-LD Product picture and brand on a SHEIN page", () => {
    const html = page({
      head:
        `<link rel="canonical" href="https://us.shein.com/Pencil-Skirt-p-515174062.html">` +
        `<meta property="og:image" content="https://img.ltwebstatic.com/images3/og.jpg">` +
        jsonLd({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Product",
              name: "High Waist Pencil Skirt",
              url: "https://us.shein.com/Pencil-Skirt-p-515174062.html",
              brand: { "@type": "Brand", name: "SHEIN Clasi" },
              image: ["//img.ltwebstatic.com/images3/skirt.jpg", "//img.ltwebstatic.com/images3/skirt-2.jpg"],
            },
          ],
        }),
    })

    const result = parseHtmlImport(html, "Skirts.html")

    expect(result.records[0]).toMatchObject({
      platform: "shein",
      videoTitle: "High Waist Pencil Skirt",
      channelName: "SHEIN Clasi",
      actualChannelName: "SHEIN Clasi",
      imageUrl: "https://img.ltwebstatic.com/images3/skirt.jpg",
    })
  })

  it("falls back to the first product gallery image, skipping the logo", () => {
    const html = page({
      head: `<link rel="canonical" href="https://www.asos.com/asos-design/straight-jeans-in-grey/prd/210636221">
        <title>ASOS DESIGN straight jeans in grey | ASOS</title>`,
      body: `<img src="https://images.asos-media.com/navigation/asos-logo.svg">
        <img src="https://www.asos.com/assets/banner.jpg">
        <img src="https://images.asos-media.com/products/jeans/210636221-1-grey?$n_640w$">`,
    })

    const result = parseHtmlImport(html, "Jeans, ASOS.html")

    expect(result.records[0]).toMatchObject({
      platform: "asos",
      videoTitle: "ASOS DESIGN straight jeans in grey",
      channelName: "ASOS",
      imageUrl: "https://images.asos-media.com/products/jeans/210636221-1-grey?$n_640w$",
    })

    // The synthesized JSON must pass the same validation the server runs.
    const validation = validateVideoRecords(JSON.parse(JSON.stringify(result.records)))
    expect(validation.ok).toBe(true)
    expect(validation.records[0].externalId).toBe("210636221")
  })

  it("skips a product page with no picture and explains why", () => {
    const html = page({
      head: `<!-- saved from url=(0050)https://www.temu.com/goods.html?goods_id=601099512345 -->`,
      body: `<h1>Garden Hose</h1>`,
    })

    const result = parseHtmlImport(html, "Garden.html")

    expect(result.ok).toBe(false)
    expect(result.records).toEqual([])
    expect(result.issues[0].message).toContain('No product picture was found for "Garden Hose"')
  })
})

describe("parseHtmlImport for a search or category page", () => {
  it("imports each product card with its picture, using lazy-loaded data-src", () => {
    const card = (id: string, name: string, image: string) =>
      `<a href="/uk/${name.toLowerCase().replace(/ /g, "-")}-g-${id}.html?refer=list">${image}</a>
       <a href="/uk/${name.toLowerCase().replace(/ /g, "-")}-g-${id}.html">${name}</a>`
    const html = page({
      head: `<link rel="canonical" href="https://www.temu.com/uk/phone-case-5020019975603-s.html">`,
      body:
        card("601000000001", "Blue Case", `<img src="//img.kwcdn.com/601000000001.jpg" alt="Blue Case">`) +
        card(
          "601000000002",
          "Red Case",
          `<img src="https://static.kwcdn.com/placeholder.png" data-src="//img.kwcdn.com/601000000002.jpg">`,
        ),
    })

    const result = parseHtmlImport(html, "Cases, Temu.html")

    expect(result.records.map((record) => [record.videoUrl, record.videoTitle, record.imageUrl])).toEqual([
      ["https://www.temu.com/uk/blue-case-g-601000000001.html", "Blue Case", "https://img.kwcdn.com/601000000001.jpg"],
      ["https://www.temu.com/uk/red-case-g-601000000002.html", "Red Case", "https://img.kwcdn.com/601000000002.jpg"],
    ])
    expect(result.issues).toEqual([])
  })

  it("skips cards whose picture had not loaded and warns", () => {
    const html = page({
      head: `<link rel="canonical" href="https://us.shein.com/women-skirts-c-1732.html">`,
      body: `<a href="/Skirt-A-p-1000001.html"><img data-src="//img.ltwebstatic.com/a.jpg" alt="Skirt A"></a>
        <a href="/Skirt-B-p-1000002.html">Skirt B</a>`,
    })

    const result = parseHtmlImport(html, "Skirts.html")

    expect(result.records.map((record) => record.videoTitle)).toEqual(["Skirt A"])
    expect(result.issues[0].message).toContain("1 product was skipped because no picture had loaded")
  })

  it("reports an error for a retailer page with no products", () => {
    const html = page({ head: `<link rel="canonical" href="https://www.asos.com/women/">` })
    const result = parseHtmlImport(html, "x.html")

    expect(result.ok).toBe(false)
    expect(result.issues[0].message).toContain("This page is from ASOS")
  })
})

describe("isProductBatch", () => {
  it("is true only when every platform in the batch is a shop", () => {
    expect(isProductBatch(["asos"])).toBe(true)
    expect(isProductBatch(["asos", "temu", "shein"])).toBe(true)
    expect(isProductBatch(["asos", "youtube"])).toBe(false)
    expect(isProductBatch(["x"])).toBe(false)
    expect(isProductBatch([])).toBe(false)
  })
})

describe("pickFromSrcset", () => {
  it("picks the widest picture up to about 1000px", () => {
    expect(pickFromSrcset("//a/x?wid=120 120w,//a/x?wid=476 476w,//a/x?wid=952 952w,//a/x?wid=1904 1904w")).toBe("//a/x?wid=952")
  })

  it("picks the smallest when every picture is larger", () => {
    expect(pickFromSrcset("//a/big 2000w, //a/bigger 3000w")).toBe("//a/big")
  })

  it("handles density descriptors and plain values", () => {
    expect(pickFromSrcset("//a/1 1x, //a/2 2x, //a/3 3x")).toBe("//a/2")
    expect(pickFromSrcset("//a/only.jpg")).toBe("//a/only.jpg")
  })
})

describe("parseHtmlImport with a real ASOS listing card", () => {
  // Trimmed from a page saved with Ctrl+S: src points at a local saved file,
  // and the real pictures are only in srcset.
  const base = "//images.asos-media.com/products/asos-design-maxi-dress/209067828-1-black"
  const srcset = [
    ["$n_240w$&amp;wid=120", "120w"],
    ["$n_480w$&amp;wid=476", "476w"],
    ["$n_960w$&amp;wid=952", "952w"],
    ["$n_1920w$&amp;wid=1904", "1904w"],
  ]
    .map(([query, width]) => `${base}?${query}&amp;fit=constrain ${width}`)
    .join(",")
  const card = `<li id="product-209067828"><a href="https://www.asos.com/asos-design/asos-design-maxi-dress/prd/209067828#colourWayId-209067836">
    <img alt="ASOS DESIGN maxi dress in black - view 1" src="./Shop _ ASOS_files/saved_resource(1)" srcset="${srcset}">
    <p>ASOS DESIGN maxi dress in black</p><span>$76.00</span><span>MORE COLOURS</span></a></li>`

  it("uses a feed-sized picture from srcset and a title without the price", () => {
    const html = page({ head: `<link rel="canonical" href="https://www.asos.com/women/new-in/cat/?cid=27108">`, body: card })
    const result = parseHtmlImport(html, "Dresses, ASOS.html")

    expect(result.records).toHaveLength(1)
    expect(result.records[0].videoTitle).toBe("ASOS DESIGN maxi dress in black")
    expect(result.records[0].videoUrl).toBe("https://www.asos.com/asos-design/asos-design-maxi-dress/prd/209067828")
    expect(result.records[0].imageUrl).toBe(
      "https://images.asos-media.com/products/asos-design-maxi-dress/209067828-1-black?$n_960w$&wid=952&fit=constrain",
    )
  })
})

describe("parseHtmlImport with a real SHEIN listing page", () => {
  // Trimmed from a page saved with Ctrl+S: SHEIN's own JSON-LD glues
  // www.shein.com onto its protocol-relative picture links, and card text
  // starts with discount badges.
  const pictureId = "1791977851b79d2a035a4e12da98f3e0f5579570eb_thumbnail_405x552.jpg"
  const productUrl = "https://www.shein.com/Men-s-Zip-Up-Sweatshirt-p-517733152.html"
  const html = page({
    head:
      `<link rel="canonical" href="https://www.shein.com/Men-Clothing-c-1969.html">` +
      jsonLd({
        "@type": "ItemList",
        itemListElement: [
          {
            "@type": "ListItem",
            item: {
              "@type": "Product",
              name: "Men's Autumn/Winter Zip-Up Sweatshirt",
              url: productUrl,
              image: `https://www.shein.com//img.ltwebstatic.com/v4/j/spmp/2026/10/14/b0/${pictureId}`,
            },
          },
        ],
      }),
    body: `<a href="/Men-s-Zip-Up-Sweatshirt-p-517733152.html">-2% Last 2 days Men's Autumn/Winter Zip-Up Sweatshirt with extra card text</a>`,
  })

  it("repairs the picture link and keeps the clean product name", () => {
    const result = parseHtmlImport(html, "Men.html")

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      platform: "shein",
      videoUrl: productUrl,
      videoTitle: "Men's Autumn/Winter Zip-Up Sweatshirt",
      imageUrl: `https://img.ltwebstatic.com/v4/j/spmp/2026/10/14/b0/${pictureId}`,
    })
  })

  it("strips leading badges from card titles but keeps names like New Balance", () => {
    const cards = page({
      head: `<link rel="canonical" href="https://www.temu.com/ng/womens-dresses-o3-1.html">`,
      body:
        `<a href="/ng/floral-dress-g-601000000011.html"><img src="https://img.kwcdn.com/a.jpg" alt="x">Top pick Elegant Floral Dress</a>` +
        `<a href="/ng/trainers-g-601000000012.html"><img src="https://img.kwcdn.com/b.jpg" alt="x">New Balance 530 trainers</a>`,
    })
    expect(parseHtmlImport(cards, "x.html").records.map((record) => record.videoTitle)).toEqual([
      "Elegant Floral Dress",
      "New Balance 530 trainers",
    ])
  })
})
