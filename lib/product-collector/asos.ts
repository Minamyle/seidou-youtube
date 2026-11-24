/**
 * ASOS collector, merged from the for_amina repository.
 *
 * ASOS blocks normal page requests, so this reads the category data feed the
 * ASOS site itself uses (/api/product/search/v2/categories/{cid}). It works
 * from a home connection; ASOS may refuse requests from cloud servers.
 */
import type { Product, ScrapeResult } from "./types";

const REGION_BY_PATH: Record<string, { store: string; country: string; currency: string; lang: string }> = {
  default: { store: "COM", country: "GB", currency: "GBP", lang: "en-GB" },
  us: { store: "US", country: "US", currency: "USD", lang: "en-US" },
  fr: { store: "FR", country: "FR", currency: "EUR", lang: "fr-FR" },
  de: { store: "DE", country: "DE", currency: "EUR", lang: "de-DE" }
};

type AsosItem = {
  id: number;
  name: string;
  brandName?: string;
  colour?: string;
  productType?: string;
  url?: string;
  imageUrl?: string;
  additionalImageUrls?: string[];
  price?: {
    currency?: string;
    current?: { value: number | null; text: string };
    previous?: { value: number | null; text: string };
  };
};

export function isAsos(url: URL) {
  return /(^|\.)asos\.com$/.test(url.hostname);
}

function withProtocol(path: string) {
  return path.startsWith("http") ? path : `https://${path}`;
}

function sized(path: string, preset: 640 | 1920, width: number) {
  const base = withProtocol(path).split("?")[0];
  return `${base}?$n_${preset}w$&wid=${width}&fit=constrain&qlt=90`;
}

function describe(item: AsosItem) {
  const parts = [item.name];
  if (item.colour) parts.push(`Colour: ${item.colour.toLowerCase()}`);
  if (item.brandName) parts.push(`Brand: ${item.brandName}`);
  return parts.join(". ");
}

async function fetchDescription(id: number, region: { store: string; currency: string; lang: string }) {
  try {
    const res = await fetch(
      `https://www.asos.com/api/product/catalogue/v3/products/${id}?store=${region.store}&lang=${region.lang}&currency=${region.currency}&sizeSchema=EU`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.description !== "string") return null;
    return data.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
  } catch {
    return null;
  }
}

export async function scrapeAsos(url: URL, limit: number, offset: number, deep: boolean): Promise<ScrapeResult> {
  const cid = url.searchParams.get("cid") || url.pathname.match(/\/cat\/?.*?(\d{3,})/)?.[1] || url.pathname.match(/\/(\d{3,})\/?$/)?.[1];
  if (!cid) throw new Error("Could not find a category id (cid) in this ASOS link");

  const regionKey = url.pathname.split("/")[1];
  const region = REGION_BY_PATH[regionKey] || REGION_BY_PATH.default;

  const api = new URL(`https://www.asos.com/api/product/search/v2/categories/${cid}`);
  api.searchParams.set("store", region.store);
  api.searchParams.set("lang", region.lang);
  api.searchParams.set("currency", region.currency);
  api.searchParams.set("country", region.country);
  api.searchParams.set("limit", String(limit));
  api.searchParams.set("offset", String(offset));

  // ASOS usually does not answer cloud servers (e.g. Vercel) at all, so the
  // request times out. Say so plainly instead of "operation was aborted".
  const blockedMessage =
    "ASOS did not answer. ASOS blocks requests from cloud servers such as Vercel, so collecting only works when this tool runs on your own computer (npm run dev). Collect there, then import the products here with the \"Import a JSON file\" tab, or import straight from your computer.";
  let res: Response;
  try {
    res = await fetch(api.toString(), { cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(blockedMessage);
    }
    throw error;
  }
  if (res.status === 403 || res.status === 429) throw new Error(blockedMessage);
  if (!res.ok) throw new Error(`ASOS responded with status ${res.status}`);
  const data = await res.json();

  const items: AsosItem[] = data.products || [];

  const descriptions = deep ? await Promise.all(items.map((i) => fetchDescription(i.id, region))) : [];

  const products: Product[] = items.map((item, index) => {
    const raw = [item.imageUrl, ...(item.additionalImageUrls || [])].filter(Boolean) as string[];
    const images = raw.map((p) => sized(p, 1920, 1926));
    const thumbnail = raw[0] ? sized(raw[0], 640, 640) : null;
    const previous = item.price?.previous?.text || null;
    return {
      id: String(item.id),
      name: item.name,
      brand: item.brandName || null,
      price: item.price?.current?.text || null,
      priceValue: item.price?.current?.value ?? null,
      previousPrice: previous || null,
      currency: item.price?.currency || null,
      description: descriptions[index] || describe(item),
      image: images[0] || null,
      thumbnail,
      images,
      url: item.url ? `https://www.asos.com/${item.url.split("#")[0]}` : null
    };
  });

  return {
    source: url.toString(),
    title: data.categoryName || null,
    total: data.itemCount ?? products.length,
    count: products.length,
    products
  };
}
