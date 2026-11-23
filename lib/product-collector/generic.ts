/**
 * Collector for other shops, merged from the for_amina repository. Reads the
 * fetched page's JSON-LD products, then Open Graph product tags, then
 * image-and-price cards. Shops that build pages with JavaScript or block
 * automated requests (Temu, SHEIN) usually return no products.
 */
import * as cheerio from "cheerio";
import { pickFromSrcset } from "../video-import/retail";
import type { Product, ScrapeResult } from "./types";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9"
};

type Json = Record<string, any>;

function absolute(value: unknown, base: string): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function pickImage(value: unknown, base: string): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((entry) => (typeof entry === "string" ? entry : entry?.url || entry?.contentUrl))
    .map((entry) => absolute(entry, base))
    .filter((entry): entry is string => Boolean(entry));
}

function flatten(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, out));
  } else if (node && typeof node === "object") {
    out.push(node as Json);
    const graph = (node as Json)["@graph"];
    if (graph) flatten(graph, out);
    const items = (node as Json).itemListElement;
    if (items) flatten(items, out);
    const inner = (node as Json).item;
    if (inner) flatten(inner, out);
  }
  return out;
}

function isProduct(node: Json) {
  const type = node["@type"];
  return Array.isArray(type) ? type.includes("Product") : type === "Product";
}

function offerOf(node: Json) {
  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  if (!offers) return { price: null as string | null, currency: null as string | null };
  const price = offers.price ?? offers.lowPrice ?? offers.priceSpecification?.price ?? null;
  return { price: price !== null ? String(price) : null, currency: offers.priceCurrency || null };
}

function fromJsonLd(node: Json, base: string, index: number): Product {
  const { price, currency } = offerOf(node);
  const images = pickImage(node.image, base);
  const brand = typeof node.brand === "string" ? node.brand : node.brand?.name || null;
  const numeric = price ? Number(price) : NaN;
  return {
    id: String(node.sku || node.productID || node["@id"] || index),
    name: String(node.name || ""),
    brand,
    price: price ? (currency ? `${currency} ${price}` : price) : null,
    priceValue: Number.isFinite(numeric) ? numeric : null,
    previousPrice: null,
    currency,
    description: node.description ? String(node.description).replace(/\s+/g, " ").trim() : null,
    image: images[0] || null,
    images,
    url: absolute(node.url, base)
  };
}

function fromCards($: cheerio.CheerioAPI, base: string): Product[] {
  const seen = new Set<string>();
  const products: Product[] = [];
  $("a:has(img)").each((index, el) => {
    const anchor = $(el);
    const href = absolute(anchor.attr("href"), base);
    const img = anchor.find("img").first();
    const src = absolute(pickFromSrcset(img.attr("srcset")) || img.attr("data-src") || img.attr("src"), base);
    const container = anchor.closest("li, article, div");
    const text = container.text().replace(/\s+/g, " ").trim();
    const priceMatch = text.match(/(?:[$£€¥₦]|USD|GBP|EUR|NGN)\s?\d[\d,]*(?:\.\d{1,2})?/);
    const name = (img.attr("alt") || anchor.attr("aria-label") || anchor.text()).replace(/\s+/g, " ").trim();
    if (!href || !src || !priceMatch || !name || seen.has(href)) return;
    seen.add(href);
    products.push({
      id: String(index),
      name,
      brand: null,
      price: priceMatch[0],
      priceValue: Number(priceMatch[0].replace(/[^\d.]/g, "")) || null,
      previousPrice: null,
      currency: null,
      description: null,
      image: src,
      images: [src],
      url: href
    });
  });
  return products;
}

export async function scrapeGeneric(url: URL): Promise<ScrapeResult> {
  const res = await fetch(url.toString(), { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`The website responded with status ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const base = url.toString();

  const nodes: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      flatten(JSON.parse($(el).contents().text()), nodes);
    } catch {
      return;
    }
  });

  let products = nodes.filter(isProduct).map((node, index) => fromJsonLd(node, base, index));

  if (products.length === 0) {
    const og = (name: string) => $(`meta[property="${name}"], meta[name="${name}"]`).attr("content") || null;
    const ogTitle = og("og:title");
    const ogImage = absolute(og("og:image"), base);
    const amount = og("product:price:amount") || og("og:price:amount");
    const currency = og("product:price:currency") || og("og:price:currency");
    if (ogTitle && ogImage && amount) {
      products = [
        {
          id: "0",
          name: ogTitle,
          brand: og("product:brand"),
          price: currency ? `${currency} ${amount}` : amount,
          priceValue: Number(amount) || null,
          previousPrice: null,
          currency,
          description: og("og:description"),
          image: ogImage,
          images: [ogImage],
          url: base
        }
      ];
    }
  }

  if (products.length === 0) products = fromCards($, base);

  products = products.filter((p) => p.name);

  return {
    source: base,
    title: $("title").first().text().trim() || null,
    total: products.length,
    count: products.length,
    products
  };
}
