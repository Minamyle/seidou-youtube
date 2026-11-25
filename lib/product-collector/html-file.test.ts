import { describe, expect, it } from "vitest"
import { parsePrice } from "../video-import/retail"
import { parseShopHtml } from "./html-file"
import { toProductRecords } from "./to-records"

const page = (head: string, body: string) => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`
const jsonLd = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`

describe("parsePrice", () => {
  it.each([
    ["₦21,405", { value: 21405, currency: "NGN", text: "₦21,405" }],
    ["#2 Bestseller $11.50 $ 11 .50 100+ sold", { value: 11.5, currency: "USD", text: "$11.50" }],
    ["Now £49.99 was £60", { value: 49.99, currency: "GBP", text: "£49.99" }],
    ["USD 20", { value: 20, currency: "USD", text: "USD20" }],
  ])("reads %s", (text, expected) => {
    expect(parsePrice(text)).toEqual(expected)
  })

  it("returns null without a price", () => {
    expect(parsePrice("100+ sold")).toBeNull()
  })
})

describe("parseShopHtml", () => {
  it("keeps Temu prices from the page's product data (NGN)", () => {
    const html = page(
      `<link rel="canonical" href="https://www.temu.com/ng/womens-dresses-o3-1.html">` +
        jsonLd({
          "@type": "ItemList",
          itemListElement: [
            {
              "@type": "ListItem",
              item: {
                "@type": "Product",
                name: "Spring/Summer Vacation Home Dress",
                url: "https://www.temu.com/ng/vacation-dress-g-606227065090746.html",
                image: "https://img.kwcdn.com/product/fancy/35d1bae4.jpg",
                offers: { "@type": "Offer", price: "21405", priceCurrency: "NGN" },
              },
            },
          ],
        }),
      "",
    )

    const file = parseShopHtml(html, "Women's Dresses - Temu Nigeria.html")
    expect(file.ok).toBe(true)
    if (!file.ok) return
    expect(file.format).toBe("page")
    expect(file.products[0]).toMatchObject({
      id: "606227065090746",
      name: "Spring/Summer Vacation Home Dress",
      price: "₦21,405",
      priceValue: 21405,
      currency: "NGN",
    })

    const records = toProductRecords(file.products, { category: "Dresses", sourceUrl: file.sourceUrl })
    expect(records.ok).toBe(true)
    expect(records.records[0]).toMatchObject({ platform: "temu", product_id: "606227065090746", price: 21405, currency: "NGN" })
  })

  it("reads a SHEIN card price printed just after the card link", () => {
    const html = page(
      `<link rel="canonical" href="https://www.shein.com/Men-Clothing-c-1969.html">`,
      `<div class="card"><a href="/Daypath-Polo-Shirt-p-568647957.html"><img src="//img.ltwebstatic.com/v4/polo.jpg" alt="x">Daypath Men's Vintage Polo Shirt</a>` +
        `<span>#2 Bestseller in Summer Men Polo Shirts</span><span>$11.50</span><span>100+ sold</span></div>` +
        `<div class="card"><a href="/Other-Shirt-p-568647958.html"><img src="//img.ltwebstatic.com/v4/other.jpg" alt="x">Other Shirt</a><span>$9.99</span></div>`,
    )

    const file = parseShopHtml(html, "Men Clothing _ SHEIN.html")
    expect(file.ok && file.products.map((product) => [product.name, product.price])).toEqual([
      ["Daypath Men's Vintage Polo Shirt", "$11.50"],
      ["Other Shirt", "$9.99"],
    ])
  })

  it("warns about products without a price and refuses pages from other sites", () => {
    const html = page(
      `<link rel="canonical" href="https://www.shein.com/Men-Clothing-c-1969.html">`,
      `<a href="/A-p-1000001.html"><img src="//img.ltwebstatic.com/a.jpg" alt="x">Shirt A</a>`,
    )
    const file = parseShopHtml(html, "x.html")
    expect(file.ok && file.issues.at(-1)?.message).toContain("1 of 1 product has no price")

    const other = parseShopHtml(page(`<link rel="canonical" href="https://example.com/">`, ""), "x.html")
    expect(other.ok).toBe(false)
  })
})
