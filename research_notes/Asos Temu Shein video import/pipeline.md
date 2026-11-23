# E-commerce Product Video Import (ASOS, Temu, SHEIN) — Engineering Design Notes

## Key Question 1: How should `VideoData` and the `platform` model be extended for retailer product videos?

### Takeaway
Extend the existing platform as **data**, not as a new table: add `"asos" | "temu" | "shein"` to the single `SUPPORTED_PLATFORMS` tuple, keep `platform` optional on `VideoData` for backward compatibility, and add a derived `mediaKind: "embed" | "direct-file"` so the renderer can branch on capability instead of hardcoding retailer names. A Zod discriminated union is technically available but is the wrong shape for this codebase because the import form, preview, export, and RPC all consume one flat record object.

### Cited Findings
- `VideoData` is a flat interface with four required string fields (`category`, `channelName`, `videoUrl`, `videoTitle`) plus `actualChannelName?`, `isUnrelatedChannel?`, and `platform?: "youtube" | "x"` — [lib/types.ts](../../lib/types.ts)
- `SUPPORTED_PLATFORMS` is a `const` tuple in `config.ts` that is reused by the Zod enum, `PLATFORM_LABELS`, `platformCounts`, and the SQL whitelist, so widening it propagates consistently — [lib/video-import/config.ts](../../lib/video-import/config.ts); [lib/video-import/validation.ts](../../lib/video-import/validation.ts); [supabase/migrations/20261029120000_add_x_video_support.sql](../../supabase/migrations/20261029120000_add_x_video_support.sql)
- `PLATFORM_LABELS` is typed as `Record<VideoPlatform, string>`, so TypeScript forces a label for every newly added platform — [lib/video-import/platforms.ts](../../lib/video-import/platforms.ts)
- The import catalogue is `public.catalogue_videos`; it has `platform` constrained to `('youtube','x')`, plus `youtube_id` and `x_post_id` columns. The Mux-owned `videos` table is not referenced anywhere in this import path — [supabase/migrations/20261021100000_video_import.sql](../../supabase/migrations/20261021100000_video_import.sql); [supabase/migrations/20261029120000_add_x_video_support.sql](../../supabase/migrations/20261029120000_add_x_video_support.sql)
- Zod exposes `z.discriminatedUnion` keyed on a literal field — [zod.dev/api?id=discriminated-unions](https://zod.dev/api?id=discriminated-unions)
- The project pins `zod` to `3.25.76`, so Zod-4-only helpers must be avoided — [package.json](../../package.json)
- The CSV export and JSON/HTML upload components read `VideoData` fields directly as flat columns (`category, channelName, videoUrl, videoTitle`) — [components/export-buttons.tsx](../../components/export-buttons.tsx); [components/html-upload.tsx](../../components/html-upload.tsx); [components/file-upload.tsx](../../components/file-upload.tsx)
- The import form renders platform names via `PLATFORM_LABELS` and sends them in the success response, so it needs no structural rewrite when new values are added — [components/video-import/json-video-import-form.tsx](../../components/video-import/json-video-import-form.tsx); [app/api/video-import/route.ts](../../app/api/video-import/route.ts)

### Inferences
**Tradeoff analysis**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| 1. Widen `VideoPlatform` union + derived `mediaKind` | Minimal churn; all existing `Record<VideoPlatform, …>` maps and count objects stay exhaustive; JSON stays flat and export-compatible | Must update CHECK constraint, RPC whitelist, labels, and `platformCounts` initializer | **Recommended** |
| 2. `z.discriminatedUnion("platform", [socialSchema, retailSchema…])` | Strongest compile-time narrowing; per-platform required fields enforced by type | Breaks the flat JSON contract, the generic validation preview, the success response, and CSV export; requires a large rewrite of form/route | Reject for v1; consider only if per-platform field sets grow large |
| 3. Separate `sourceType: "social" | "retailer"` while keeping `platform` as `string` | Avoids widening the SQL CHECK immediately | Two fields that can disagree, still needs a whitelist, and still needs a render discriminator — strictly worse than option 1 | Reject |

**Proposed `lib/types.ts` change** (keep one source of truth in `config.ts`):

```ts
import type { VideoPlatform } from "./video-import/config"

export type { VideoPlatform } from "./video-import/config"
export type VideoMediaKind = "embed" | "direct-file"

export interface RetailProductMeta {
  productId: string
  productUrl: string
  brand?: string
  price?: string
  priceCurrency?: string
  thumbnailUrl?: string | null
  videoExpiresAt?: string | null
}

export interface VideoData {
  category: string
  channelName: string
  videoUrl: string
  videoTitle: string
  actualChannelName?: string
  isUnrelatedChannel?: boolean
  platform?: VideoPlatform
  mediaKind?: VideoMediaKind
  product?: RetailProductMeta
  /** Set only when the bytes are mirrored into Supabase Storage. */
  storagePath?: string | null
}
```

**Proposed `config.ts` change:**

```ts
export const SUPPORTED_PLATFORMS = ["youtube", "x", "asos", "temu", "shein"] as const
export type VideoPlatform = (typeof SUPPORTED_PLATFORMS)[number]

export const RETAIL_PLATFORMS = ["asos", "temu", "shein"] as const
export type RetailPlatform = (typeof RETAIL_PLATFORMS)[number]

export const KNOWN_JSON_FIELDS = [
  ...REQUIRED_JSON_FIELDS,
  ...OPTIONAL_JSON_FIELDS,
  "mediaKind", "product", "storagePath",
] as const

export const PRODUCT_VIDEO_BUCKET = "product-videos"
export const PRODUCT_VIDEO_SIGNED_TTL_SECONDS = 3600
export const PRODUCT_VIDEO_MAX_BYTES = 50 * 1024 * 1024
```

**Proposed helper in `platforms.ts`:**

```ts
export function getMediaKind(platform: VideoPlatform): VideoMediaKind {
  return (RETAIL_PLATFORMS as readonly string[]).includes(platform) ? "direct-file" : "embed"
}
```

`getMediaKind` should be *derived* from `platform` during validation, not trusted from user JSON; the `mediaKind` field in JSON is only a hint that re-validates against the detected platform.

### Gaps
- Should `channelName` for retailer records be the brand, the retailer name (`ASOS`, `Temu`, `SHEIN`), or a literal `Unknown Channel`? The current UI presents this field as "Channel Name" and treats mismatches via `isUnrelatedChannel`, which has no clear meaning for products — needs a product decision.
- Whether the product requirement is "one video per product" or "many videos per product" affects the `externalId`/dedupe key; this is unresolved.
- The Zod documentation consulted is for a newer major version than the installed `3.25.76`; `z.discriminatedUnion` exists in both, but any proposed helper must be smoke-tested against the pinned version before use.

## Key Question 2: How do validation rules differ between social and e-commerce records, and what schema should be used?

### Takeaway
Social validation is URL-pattern- and channel-centric; retail validation must be **product-centric**: allowlisted retailer hosts, a required product identifier, optional price/currency/SKU metadata, and an explicit treatment of signed CDN URLs and their expiry. Implement this as a base record schema plus a retail refinement, reusing the existing `superRefine` + `new URL()` style so it works under the pinned Zod 3.25.76.

### Cited Findings
- The current `videoRecordSchema` requires `category`, `channelName`, `videoTitle`, `videoUrl`; checks `http:`/`https:` via `new URL()`; rejects any URL not recognized by `detectVideoPlatform`; and cross-checks a supplied `platform` against the detected one — [lib/video-import/validation.ts](../../lib/video-import/validation.ts)
- `KNOWN_JSON_FIELDS` currently lists only the four required and three optional fields; any new field not added there produces an "Unrecognized field(s) ignored" warning — [lib/video-import/config.ts](../../lib/video-import/config.ts); [lib/video-import/validation.ts](../../lib/video-import/validation.ts)
- Deduplication in TypeScript uses the key `` `${platform}:${externalId}` ``; the SQL RPC partitions on `(platform, external_id)` — [lib/video-import/validation.ts](../../lib/video-import/validation.ts); [supabase/migrations/20261029120000_add_x_video_support.sql](../../supabase/migrations/20261029120000_add_x_video_support.sql)
- `actualChannelName` is nullish and `isUnrelatedChannel` defaults to `false`, so both remain harmless for retail records — [lib/video-import/validation.ts](../../lib/video-import/validation.ts)
- schema.org `Product` defines `sku`, `brand`, `image`, `url`, and `offers.price` / `offers.priceCurrency`, which are the natural source fields for a saved product page — [schema.org/Product](https://schema.org/Product)
- schema.org `VideoObject` defines `contentUrl`, `embedUrl`, `thumbnailUrl` / `thumbnail`, `expires`, and `uploadDate`, which cover media URL, poster, and expiry — [schema.org/VideoObject](https://schema.org/VideoObject)
- `z.string().datetime()` and `.superRefine()` are Zod 3 APIs; the project avoids newer helpers such as `z.httpUrl()` by hand-rolling `new URL()` validation — [package.json](../../package.json); [lib/video-import/validation.ts](../../lib/video-import/validation.ts); [zod.dev/api?id=discriminated-unions](https://zod.dev/api?id=discriminated-unions)

### Inferences
**Validation differences to encode**

| Aspect | YouTube / X | ASOS / Temu / SHEIN |
|---|---|---|
| `videoUrl` check | Host + ID regex (`youtube.com`, `youtu.be`, `x.com`, `twitter.com`) | Any `http(s)` URL, but tag as signed/expiring when it has token-like query params; paired with a retailer allowlist on `product.productUrl` |
| Identity | 11-char YouTube ID / numeric X status ID | `productId` (SKU) plus a normalized-media key; do **not** use the raw signed URL as identity |
| Required metadata | `channelName` meaningful | `product.productId` + `product.productUrl` required; `channelName` is a display label only |
| Optional metadata | `actualChannelName`, `isUnrelatedChannel` | `brand`, `price`, `priceCurrency`, `thumbnailUrl`, `videoExpiresAt` |
| Rendering | iframe embed | native `<video>` file playback |
| Dedupe risk | Same video posted twice | Same product with different CDN tokens / locale variants |

**Proposed `lib/video-import/retail/schema.ts` (Zod 3.25-compatible):**

```ts
import { z } from "zod"
import { RETAIL_PLATFORMS, type RetailPlatform, type VideoPlatform } from "../config"

export const RETAIL_HOSTS: Record<RetailPlatform, string[]> = {
  asos: ["asos.com", "www.asos.com"],
  temu: ["temu.com", "www.temu.com"],
  shein: ["shein.com", "www.shein.com"],
}

export function isRetailPlatform(platform: VideoPlatform): platform is RetailPlatform {
  return (RETAIL_PLATFORMS as readonly string[]).includes(platform)
}

export function retailHostAllowed(platform: RetailPlatform, value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return (RETAIL_HOSTS[platform] ?? []).some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    )
  } catch {
    return false
  }
}

export function looksSigned(value: string): boolean {
  try {
    const url = new URL(value)
    return ["token", "sig", "signature", "expires", "exp", "x-amz-signature", "auth"]
      .some((key) => url.searchParams.has(key))
  } catch {
    return false
  }
}

const httpUrl = z.string().trim().min(1).superRefine((value, ctx) => {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol")
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "must be a full http:// or https:// URL",
    })
  }
})

export const retailProductSchema = z.object({
  productId: z.string().trim().min(1, "must not be empty"),
  productUrl: httpUrl,
  brand: z.string().trim().min(1).optional(),
  price: z
    .string()
    .regex(/^\d+(?:\.\d{1,2})?$/, "must be a decimal price such as 19.99")
    .optional(),
  priceCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/, "must be a 3-letter ISO 4217 code")
    .optional(),
  thumbnailUrl: httpUrl.nullish(),
  videoExpiresAt: z.string().datetime({ offset: true }).nullish(),
})

/** Call after the base schema has accepted the record. */
export function refineRetailRecord(
  record: {
    platform: VideoPlatform
    videoUrl: string
    product?: z.infer<typeof retailProductSchema>
  },
  ctx: z.RefinementCtx,
  path: (key: string) => (string | number)[],
): void {
  if (!isRetailPlatform(record.platform)) return
  if (!record.product) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: path("product"), message: "is required for retailer videos" })
    return
  }
  if (!retailHostAllowed(record.platform, record.product.productUrl)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path("product"), "productUrl"],
      message: `must be an ${record.platform} product URL`,
    })
  }
  if (looksSigned(record.videoUrl) && !record.product.videoExpiresAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path("product"), "videoExpiresAt"],
      message: "is required when videoUrl is a signed CDN URL",
    })
  }
  if (record.product.price && !record.product.priceCurrency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path("product"), "priceCurrency"],
      message: "is required when price is present",
    })
  }
}
```

Integration into `validateVideoRecords`: keep the existing `videoRecordSchema.safeParse(item)`, then call `refineRetailRecord(value, ctx, (key) => [key])` from the record-level `superRefine`, and set `mediaKind = getMediaKind(detected.platform)`. For the `externalId`, normalize away query/fragment before deriving identity, e.g. `externalId = `${product.productId}:${normalize(videoUrl).split("/").pop()}`` or a Web-Crypto SHA-256 prefix of the normalized URL; this prevents a rotated CDN token from creating a duplicate row.

Suggested new tests alongside `validation.test.ts`:
- `https://www.asos.com/...` + `product.productId` accepted; `https://evil.example/...` product URL rejected with field `product.productUrl`.
- Signed `videoUrl` without `product.videoExpiresAt` rejected; with expiry accepted.
- `price` without `priceCurrency` rejected.
- A record with `mediaKind: "embed"` but platform `shein` normalized to `"direct-file"`.
- Existing YouTube/X fixtures still pass unchanged (backward-compatibility guard).

### Gaps
- No authoritative ASOS/Temu/SHEIN documentation was found for SKU format, locale-specific price/currency formatting, or whether `sku` is present in JSON-LD on every product page; the schema should therefore treat price/currency/brand as optional.
- The exact query-parameter names used for retailer CDN signatures are unknown; `looksSigned` is a heuristic that must be tuned against real captured URLs.
- Whether retailers' signed URL expiry is exposed as an ISO timestamp in `VideoObject.expires` on their pages is unverified; if absent, `videoExpiresAt` can only be inferred by the user in the form.

## Key Question 3: Where should the actual video bytes live, and what should `videoUrl` contain?

### Takeaway
Default to storing the retailer's resolved media URL as `videoUrl` in JSON (zero binary upload, fully consistent with "only JSON crosses the network to Supabase"), and offer an **opt-in** browser-direct mirror into a private Supabase Storage bucket for durability. A server-side download/proxy is out of scope because it would require server-side fetching from retailer CDNs.

### Cited Findings
- Supabase Storage buckets are either public or private; private objects are served through signed URLs with an expiry — [Supabase Storage fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- A signed URL cannot be individually revoked once issued; it remains valid until its expiry — [Supabase signed downloads](https://supabase.com/docs/guides/storage/serving/downloads)
- Standard uploads are recommended for small files, while TUS/resumable uploads are for larger or unreliable connections — [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- Public buckets are served through the CDN and get better cache hit rates than private signed delivery — [Supabase CDN fundamentals](https://supabase.com/docs/guides/storage/cdn/fundamentals)
- Storage cost includes stored bytes, egress, and transformations — [Supabase pricing](https://supabase.com/pricing)
- The HTML `<video>` element requires a correct MIME type, supports multiple `<source>` fallbacks, a `poster`, `preload`, and fires an `error` event when loading fails — [MDN `<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video)
- The `Referer` header is sent by browsers on subresource requests and can be used by servers to make decisions about hotlinked media — [MDN `Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer)
- No authoritative primary-source documentation was found for ASOS/Temu/SHEIN CDN URL lifetime, hotlink policy, or CORS headers — gap recorded below.

### Inferences
**Hosting options**

| Option | What JSON stores | Pros | Risks | Recommendation |
|---|---|---|---|---|
| A. Retailer CDN hotlink | `videoUrl` = resolved CDN URL; `product.videoExpiresAt` when known | No new infra; no binary upload; server sees JSON only | Token expiry, hotlink blocking, CORS, retailer layout changes | **Default** |
| B. Browser-direct mirror to private Supabase Storage | `videoUrl` = signed Storage URL (short TTL), `storagePath` = object path | Durable, independent of retailer CDN; stable identity | Browser must fetch blob from retailer (CORS) and upload bytes to Storage; signed URLs expire mid-playback and cannot be revoked | Opt-in; requires product sign-off on binary upload |
| C. Server-side download & mirror | same as B | Avoids browser CORS | Requires server-side fetching from retailer CDN and binary upload — violates the "no server-side scraping" / JSON-only design | Reject |

**Representation rules for option A**
- Store the *resolved* media URL (`VideoObject.contentUrl` or `<video>/<source src>` from the saved page), not the marketing product page.
- Keep `product.productUrl` as the stable canonical product URL; use it for display/identity.
- Treat `videoUrl` as volatile: never use it as the dedupe key; persist `product.videoExpiresAt` when available and let the UI show "Media link expired — re-import" when `Date.now() > videoExpiresAt`.
- Resolve protocol-relative (`//cdn…`) and relative URLs against the canonical product URL in the browser before writing JSON.

**Representation rules for option B**
- Browser uploads directly with `@supabase/supabase-js` to `product-videos`, then writes only `storagePath` into the JSON records; the API route remains JSON-only.
- At render time, call a new `/api/product-video-url` route that accepts a JSON body `{ path }` and returns `{ signedUrl, expiresAt }`; the browser then streams bytes directly from Storage to `<video>`.
- Use a short TTL (e.g. 3600s) and refresh on the `<video>` `error` event and before playback; do not persist signed URLs in the database.

### Gaps
- Retailer CDN URL lifetime and hotlink rules are unknown; the design assumes links may expire and must be refreshable.
- It is unknown whether retailer CDNs send `Access-Control-Allow-Origin`, which determines whether option B's browser-side blob fetch is even possible without a proxy.
- Product decision needed: is durability worth allowing binary uploads to Supabase Storage, given the JSON-only constraint? If not, ship option A only.

## Key Question 4: How should Supabase Storage be configured?

### Takeaway
Reuse the existing private `video-import-images` bucket as-is, and add one new **private** `product-videos` bucket with explicit MIME/size limits and service-role-only policies. Keep signed URL generation at read time, never persisted, and document that signed URLs cannot be individually revoked.

### Cited Findings
- The existing migration creates a private bucket with `insert into storage.buckets (id, name, public) values ('video-import-images', 'video-import-images', false)` — [supabase/migrations/20261021100000_video_import.sql](../../supabase/migrations/20261021100000_video_import.sql)
- The API uploads only the batch image bytes via `supabase.storage.from(BATCH_IMAGE_BUCKET).upload(...)` and creates a 600-second signed URL for the preview — [app/api/video-import/route.ts](../../app/api/video-import/route.ts); [lib/video-import/config.ts](../../lib/video-import/config.ts)
- Service-role clients bypass Row Level Security, which is why the current image bucket works without explicit `storage.objects` policies — [Supabase access control](https://supabase.com/docs/guides/storage/security/access-control)
- Buckets support `public`, `allowedMimeTypes`, and `fileSizeLimit` options — [Supabase createBucket reference](https://supabase.com/docs/reference/javascript/file-buckets-createbucket); [Supabase Storage fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- `storage.objects` is the table governed by RLS policies for object access — [Supabase access control](https://supabase.com/docs/guides/storage/security/access-control)
- Signed URLs have a caller-supplied expiry and cannot be individually revoked — [Supabase signed downloads](https://supabase.com/docs/guides/storage/serving/downloads)

### Inferences
**New migration snippet (add to the e-commerce migration):**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-videos',
  'product-videos',
  false,
  52428800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Service role can manage product videos" on storage.objects;
create policy "Service role can manage product videos"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'product-videos')
  with check (bucket_id = 'product-videos');
```

Do **not** create a public read policy for anonymous users unless the product intentionally wants permanent, uncached-link-free public playback; a public bucket trades revocation control for CDN cache hits.

**Server helper (new `lib/storage/product-videos.ts`):**

```ts
import { getServiceClient } from "@/lib/supabase/server"
import { PRODUCT_VIDEO_BUCKET, PRODUCT_VIDEO_SIGNED_TTL_SECONDS } from "@/lib/video-import/config"

export async function signProductVideo(path: string): Promise<{ signedUrl: string; expiresAt: string }> {
  const supabase = getServiceClient()
  const expiresIn = PRODUCT_VIDEO_SIGNED_TTL_SECONDS
  const { data, error } = await supabase.storage
    .from(PRODUCT_VIDEO_BUCKET)
    .createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) throw error ?? new Error("Could not sign product video")
  return {
    signedUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }
}
```

Keep the existing `SIGNED_URL_TTL_SECONDS = 600` for images; give videos a separate, longer TTL constant because playback outlives a thumbnail preview. Add validation that `path` belongs to the expected prefix (batch id) before signing, so a malicious JSON payload cannot sign arbitrary objects.

### Gaps
- Storage quota/egress budget for video playback is not defined; the 50 MB per-object limit is an engineering default, not a product requirement.
- Whether to enable a public bucket (better CDN caching) versus private signed URLs (revocation control) needs a product decision.

## Key Question 5: What parser module layout and test strategy should be used for browser-side HTML→JSON conversion?

### Takeaway
Split the single `html.ts` orchestrator into a shared `retail/` directory with one thin adapter per retailer and shared JSON-LD/`<video>` extractors. Keep parsing as pure string/JSON logic (no DOM APIs, no network) so the exact same code runs in the browser import form and in Vitest, matching the existing parser's design.

### Cited Findings
- `parseHtmlImport(html, fileName)` currently orchestrates `looksLikeXPage`, `extractXRecords`, and `extractYouTubeRecords` in one file, using regex, `extractElements`, and HTML-entity decoding helpers — [lib/video-import/html.ts](../../lib/video-import/html.ts)
- The existing parser is pure (no `fetch`, no `DOMParser`), which is why it can be unit-tested directly in Node/Vitest with string fixtures — [lib/video-import/html.test.ts](../../lib/video-import/html.test.ts); [package.json](../../package.json)
- The client form converts HTML to a synthesized JSON `File` via `new File([JSON.stringify(parsed.records)], …)` and posts it; the server never sees HTML — [components/video-import/json-video-import-form.tsx](../../components/video-import/json-video-import-form.tsx)
- JSON-LD `Product` and `VideoObject` provide the fields needed to populate retail records without retailer-specific DOM scraping — [schema.org/Product](https://schema.org/Product); [schema.org/VideoObject](https://schema.org/VideoObject)
- `<video>` and `<source>` elements expose `src` and `type`, and `<video>` exposes `poster`, which are the fallback extraction points when JSON-LD is missing — [MDN `<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video)

### Inferences
**Proposed layout**

```
lib/video-import/
  config.ts                 # extended platforms, fields, bucket constants
  platforms.ts              # detectVideoPlatform, PLATFORM_LABELS, getMediaKind
  html.ts                   # orchestrator: calls X/YouTube + retail parsers
  retail/
    types.ts                # RetailProductRecord, ExtractedMedia
    jsonld.ts               # extractJsonLdObjects, findProductNode, findVideoNode
    media.ts                # extractVideoSources, resolveUrl, decodeHtmlEntities
    asos.ts                 # host check + ASOS-specific selectors/overrides
    temu.ts
    shein.ts
    schema.ts               # retailProductSchema / refineRetailRecord (Q2)
    index.ts                # parseRetailProductHtml(html, platform, fileName)
    jsonld.test.ts
    media.test.ts
    asos.test.ts
    temu.test.ts
    shein.test.ts
```

**Shared JSON-LD extractor:**

```ts
export function extractJsonLdObjects(html: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = []
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = scriptPattern.exec(html))) {
    try {
      const parsed: unknown = JSON.parse(decodeHtmlEntities(match[1]).trim())
      const nodes = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>)["@graph"])
          ? ((parsed as Record<string, unknown>)["@graph"] as unknown[])
          : [parsed]

      for (const node of nodes) {
        if (node && typeof node === "object" && !Array.isArray(node)) {
          results.push(node as Record<string, unknown>)
        }
      }
    } catch {
      // Malformed JSON-LD blocks are ignored with a warning by the caller.
    }
  }

  return results
}

export function hasType(node: Record<string, unknown>, type: string): boolean {
  const value = node["@type"]
  return value === type || (Array.isArray(value) && value.includes(type))
}
```

**Record mapping (conceptual):**

```ts
const productNode = jsonld.find((node) => hasType(node, "Product"))
const videoNode = jsonld.find((node) => hasType(node, "VideoObject"))

const canonicalUrl =
  (doc as Record<string, string>)["canonical"] ??
  /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i.exec(html)?.[1] ??
  ""

const media = videoNode
  ? { src: String(videoNode.contentUrl ?? videoNode.embedUrl ?? ""),
      poster: String(videoNode.thumbnailUrl ?? videoNode.thumbnail ?? "") }
  : extractVideoSources(html)          // <video src>, <source src type>

const product = {
  productId: String(productNode?.sku ?? extractSkuFromPath(canonicalUrl)),
  productUrl: canonicalUrl,
  brand: normaliseBrand(productNode?.brand),
  price: priceFromOffer(productNode?.offers),
  priceCurrency: currencyFromOffer(productNode?.offers),
  thumbnailUrl: media.poster || metaContent(html, "og:image"),
  videoExpiresAt: videoNode?.expires ? String(videoNode.expires) : null,
}
```

`extractSkuFromPath` and retailer-specific selectors live in `asos.ts` / `temu.ts` / `shein.ts`; each adapter exports `hostPatterns`, `extractProductId(html, canonicalUrl)`, and optional `normaliseSku`. `html.ts` should call retail extraction only when the saved page's canonical URL or `<base>` host matches one of the three allowlisted hosts, mirroring the current `looksLikeXPage` guard that prevents X pages from emitting YouTube links.

**Tests to add** (mirroring `html.test.ts` style with inline HTML fixtures):
1. ASOS page with JSON-LD `Product` + `VideoObject` → one record with `platform: "asos"`, `mediaKind: "direct-file"`, `product.productId` from `sku`.
2. Temu and SHEIN variants, including protocol-relative `contentUrl` resolved against `canonical`.
3. Page with only `<video><source src="…webm" type="video/webm"></video>` (no JSON-LD) → record with correct MIME hint.
4. Malformed JSON-LD block → ignored with a warning, fallback extractors used.
5. Expired `VideoObject.expires` → validation warning surfaced in the preview.
6. Canonical host not in allowlist → no retail record emitted.
7. Existing X/YouTube fixtures from `html.test.ts` still pass (no regression).
8. Two products on one page → two records, or explicit warning if disambiguation fails.

### Gaps
- Real saved-page HTML from ASOS/Temu/SHEIN was not available, so selector choices and JSON-LD presence are hypotheses; fixtures must be captured from actual pages before implementation.
- Whether these sites render product video via JSON-LD, `<video>`, or a JS-only player in saved HTML is unverified; if JS-only, browser-side parsing cannot recover the media URL from a static save and the feature needs a different input (e.g. pasted CDN URL).

## Key Question 6: How should the display layer branch between iframe embeds and native video?

### Takeaway
Extend `VideoCard` with a three-way branch — YouTube iframe, X iframe, and retailer `<video>` — deriving the branch from `platform`/`mediaKind`, with a safe "Invalid media URL" fallback. Keep signed URL refresh behind a JSON-only API route so no HTML or scraped content is ever sent to the server.

### Cited Findings
- `VideoCard` currently calls `detectVideoPlatform(video.videoUrl)` and builds either a YouTube embed URL or a Twitter embed URL; anything else renders "Invalid video URL" — [components/video-card.tsx](../../components/video-card.tsx)
- The HTML `<video>` element supports `controls`, `poster`, `preload`, `playsInline`, multiple `<source>` children, and an `error` event — [MDN `<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video)
- `crossorigin` on media elements changes CORS behavior and can taint canvas when frames are drawn; it should be omitted unless frame extraction is needed — [MDN `<video>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video)
- Browsers send `Referer` on subresource requests, which can influence hotlink handling by a CDN — [MDN `Referer`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer)
- Signed URLs expire and cannot be individually revoked, so they should be refreshed rather than stored in the catalogue — [Supabase signed downloads](https://supabase.com/docs/guides/storage/serving/downloads)
- `VideoGrid` keys cards by `video.videoUrl`; volatile signed URLs would cause remounts, reinforcing the need to keep a stable identifier — [components/video-grid.tsx](../../components/video-grid.tsx)

### Inferences
**Proposed `VideoCard` branch:**

```tsx
const detected = detectVideoPlatform(video.videoUrl)
const platform = video.platform ?? detected?.platform ?? null
const mediaKind =
  video.mediaKind ?? (platform && RETAIL_PLATFORMS.includes(platform as RetailPlatform) ? "direct-file" : "embed")

const embedUrl =
  platform === "youtube" && detected
    ? `https://www.youtube.com/embed/${detected.externalId}`
    : platform === "x" && detected
      ? `https://platform.twitter.com/embed/Tweet.html?id=${detected.externalId}`
      : null

const expired =
  video.product?.videoExpiresAt != null &&
  Date.parse(video.product.videoExpiresAt) <= Date.now()
```

```tsx
{mediaKind === "embed" && embedUrl ? (
  <iframe src={embedUrl} title={video.videoTitle} allowFullScreen className="w-full h-full" />
) : mediaKind === "direct-file" && !expired ? (
  <video
    controls
    playsInline
    preload="metadata"
    poster={video.product?.thumbnailUrl ?? undefined}
    referrerPolicy="no-referrer"
    className="w-full h-full"
    onError={() => void refreshMediaUrl()}
  >
    <source src={video.videoUrl} type="video/mp4" />
    <source src={video.videoUrl.replace(/\.mp4(?=\?|$)/, ".webm")} type="video/webm" />
    Your browser does not support HTML video.
  </video>
) : (
  <div className="w-full h-full grid place-items-center text-sm text-muted-foreground">
    {expired ? "Media link expired — re-import this product" : "Invalid media URL"}
  </div>
)}
```

`refreshMediaUrl` should be a no-op for hotlinked retailer URLs, and for mirrored objects should `fetch("/api/product-video-url", { method: "POST", body: JSON.stringify({ path: video.storagePath }) })`, then swap the `<source src>` with the returned signed URL until `expiresAt`. That route returns JSON only.

Add a `ProductMeta` block under the title showing `brand`, `price`/`priceCurrency`, and a link to `product.productUrl`, while leaving the existing `channelName` badge and `isUnrelatedChannel` warning untouched for backward compatibility. Add a card-level badge via `PLATFORM_LABELS[platform]` so users can see which retailer a product came from.

### Gaps
- `referrerPolicy="no-referrer"` reduces leakage of the app origin but may break CDNs that allowlist a specific referrer; the correct policy depends on undocumented retailer CDN behavior.
- Whether `<source>` MIME hints should be `video/mp4`, `video/webm`, or `application/x-mpegURL` (HLS) depends on the actual retailer media format; browsers do not play HLS natively in all cases, so a player library may be needed if links are `.m3u8`.

## Key Question 7: What changes are required in the API route and import form while keeping the JSON-only boundary?

### Takeaway
No new server-side fetching is needed: the browser remains the only place that reads retailer HTML and converts it to JSON, and the route continues to accept a synthesized JSON `File` plus one batch image. The route changes are limited to re-validation, record mapping, and count/label plumbing.

### Cited Findings
- The route reads `FormData` fields `jsonFile`, `image`, `conflictsAcknowledged`, `sourceFilename`; parses JSON; calls `validateVideoRecords`; uploads the image; and calls the `import_video_batch` RPC — [app/api/video-import/route.ts](../../app/api/video-import/route.ts)
- Next.js route handlers are the supported server endpoint mechanism in the App Router — [Next.js route handler docs](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- The client form chooses HTML vs JSON by extension, calls `parseHtmlImport`, validates, and builds a synthetic `.json` `File` before POSTing — [components/video-import/json-video-import-form.tsx](../../components/video-import/json-video-import-form.tsx)
- `platformCounts` is initialized literally as `{ youtube: 0, x: 0 }`, so new platforms would silently produce `undefined` counts until updated — [lib/video-import/validation.ts](../../lib/video-import/validation.ts)
- The RPC call passes records with `video_url`, `platform`, `external_id`, `video_title`, `category`, `channel_name`, `actual_channel_name`, `is_unrelated_channel` — [app/api/video-import/route.ts](../../app/api/video-import/route.ts)

### Inferences
**Required edits**

1. `lib/video-import/validation.ts`: call `refineRetailRecord` in the record `superRefine`; initialize `platformCounts` from `SUPPORTED_PLATFORMS` (`Object.fromEntries(SUPPORTED_PLATFORMS.map(p => [p, 0])) as Record<VideoPlatform, number>`); set `mediaKind` on the emitted record; keep dedupe on `platform:externalId` with the normalized `externalId`.
2. `lib/video-import/platforms.ts`: add labels `asos: "ASOS"`, `temu: "Temu"`, `shein: "SHEIN"`.
3. `app/api/video-import/route.ts`: extend the record mapping passed to the RPC:

```ts
const records = validation.records.map((record) => ({
  video_url: record.videoUrl,
  platform: record.platform,
  external_id: record.externalId,
  media_kind: record.mediaKind,
  video_title: record.videoTitle,
  category: record.category,
  channel_name: record.channelName,
  actual_channel_name: record.actualChannelName,
  is_unrelated_channel: record.isUnrelatedChannel,
  product_id: record.product?.productId ?? null,
  product_url: record.product?.productUrl ?? null,
  product_brand: record.product?.brand ?? null,
  product_price: record.product?.price ?? null,
  product_currency: record.product?.priceCurrency ?? null,
  video_thumbnail_url: record.product?.thumbnailUrl ?? null,
  video_expires_at: record.product?.videoExpiresAt ?? null,
  storage_path: record.storagePath ?? null,
}))
```

4. `components/video-import/json-video-import-form.tsx`: update the help text from "YouTube and X (Twitter) video links are both supported" to include ASOS/Temu/SHEIN, and make the HTML hint mention saved product pages.
5. `components/video-import/validation-preview.tsx`: the platform summary uses `formatPlatformSummary`, which becomes correct automatically once labels and counts are widened.

No server-side `fetch` to a retailer URL should be added anywhere in `app/api/`. If opt-in mirroring ships, the browser calls `supabase.storage.from(PRODUCT_VIDEO_BUCKET).upload(...)` directly and only the resulting `storagePath` enters the JSON payload.

### Gaps
- The exact shape of `ValidationPreview` was not inspected in full; it may need an extra section for `product` metadata and expiry warnings beyond the label/count changes.
- It is not yet decided whether a missing product URL should block import or only warn; the schema above blocks it, which may be too strict for hand-authored JSON.

## Key Question 8: What migration SQL and RPC update are needed without touching the Mux `videos` table?

### Takeaway
Add one forward migration that widens the `catalogue_videos.platform` CHECK, adds nullable retail metadata columns and indexes, and replaces `import_video_batch` with a version that whitelists the three new platforms and maps retail fields — explicitly leaving any Mux-managed `videos` table untouched.

### Cited Findings
- The original migration creates `catalogue_videos`, its unique indexes, RLS policies, the private image bucket, and the first `import_video_batch` function — [supabase/migrations/20261021100000_video_import.sql](../../supabase/migrations/20261021100000_video_import.sql)
- The X migration adds `platform`/`x_post_id`, a `catalogue_videos_platform_check` CHECK limited to `('youtube','x')`, and a service-role-only RPC with a platform whitelist — [supabase/migrations/20261029120000_add_x_video_support.sql](../../supabase/migrations/20261029120000_add_x_video_support.sql)
- `CREATE OR REPLACE FUNCTION` preserves existing grants, and the RPC is executable only by `service_role` — [supabase/migrations/20261021100000_video_import.sql](../../supabase/migrations/20261021100000_video_import.sql); [supabase/migrations/20261029120000_add_x_video_support.sql](../../supabase/migrations/20261029120000_add_x_video_support.sql)
- Service-role clients bypass RLS — [Supabase access control](https://supabase.com/docs/guides/storage/security/access-control)
- `video_import_batches.platforms` is already `text[]`, so it needs no schema change — [supabase/migrations/20261029120000_add_x_video_support.sql](../../supabase/migrations/20261029120000_add_x_video_support.sql)

### Inferences
**New file: `supabase/migrations/20261119120000_add_ecommerce_video_support.sql`**

```sql
-- Do NOT touch any Mux-managed "videos" table. This migration only widens the
-- import catalogue introduced by 20261021100000_video_import.sql.

alter table public.catalogue_videos
  add column if not exists media_kind text not null default 'embed'
    check (media_kind in ('embed', 'direct-file')),
  add column if not exists product_id text,
  add column if not exists product_url text,
  add column if not exists product_brand text,
  add column if not exists product_price numeric(12,2),
  add column if not exists product_currency text,
  add column if not exists video_thumbnail_url text,
  add column if not exists video_expires_at timestamptz,
  add column if not exists storage_path text;

alter table public.catalogue_videos
  drop constraint if exists catalogue_videos_platform_check;

alter table public.catalogue_videos
  add constraint catalogue_videos_platform_check
  check (platform in ('youtube', 'x', 'asos', 'temu', 'shein'));

create unique index if not exists catalogue_videos_retail_product_key
  on public.catalogue_videos (platform, product_id)
  where product_id is not null;

create index if not exists catalogue_videos_media_kind_idx
  on public.catalogue_videos (media_kind);

create or replace function public.import_video_batch(
  p_batch_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_total integer;
begin
  if exists (
    select 1
    from jsonb_array_elements(p_records) as record
    where coalesce(nullif(lower(record ->> 'platform'), ''), 'youtube')
          not in ('youtube', 'x', 'asos', 'temu', 'shein')
  ) then
    raise exception 'Unsupported video platform in batch';
  end if;

  select count(*) into v_total from jsonb_array_elements(p_records);

  with raw as (
    select
      (record ->> 'video_url') as video_url,
      coalesce(nullif(lower(record ->> 'platform'), ''), 'youtube') as platform,
      nullif(record ->> 'external_id', '') as external_id,
      coalesce(nullif(lower(record ->> 'media_kind'), ''), 'embed') as media_kind,
      (record ->> 'video_title') as video_title,
      (record ->> 'category') as category,
      (record ->> 'channel_name') as channel_name,
      nullif(record ->> 'actual_channel_name', '') as actual_channel_name,
      coalesce((record ->> 'is_unrelated_channel')::boolean, false) as is_unrelated_channel,
      nullif(record ->> 'product_id', '') as product_id,
      nullif(record ->> 'product_url', '') as product_url,
      nullif(record ->> 'product_brand', '') as product_brand,
      nullif(record ->> 'product_price', '')::numeric as product_price,
      nullif(upper(nullif(record ->> 'product_currency', '')), '') as product_currency,
      nullif(record ->> 'video_thumbnail_url', '') as video_thumbnail_url,
      nullif(record ->> 'video_expires_at', '')::timestamptz as video_expires_at,
      nullif(record ->> 'storage_path', '') as storage_path,
      row_number() over (
        partition by
          coalesce(nullif(lower(record ->> 'platform'), ''), 'youtube'),
          coalesce(nullif(record ->> 'external_id', ''), record ->> 'video_url')
        order by record ->> 'video_url'
      ) as rn
    from jsonb_array_elements(p_records) as record
  ),
  incoming as (
    select
      r.*,
      case when r.platform = 'youtube' then r.external_id end as youtube_id,
      case when r.platform = 'x' then r.external_id end as x_post_id
    from raw r
    where r.rn = 1
  ),
  filtered as (
    select i.*
    from incoming i
    where not exists (
      select 1 from public.catalogue_videos v
      where v.video_url = i.video_url
         or (i.youtube_id is not null and v.youtube_id = i.youtube_id)
         or (i.x_post_id is not null and v.x_post_id = i.x_post_id)
         or (i.product_id is not null and v.platform = i.platform and v.product_id = i.product_id)
    )
  ),
  inserted as (
    insert into public.catalogue_videos (
      video_url, platform, media_kind, youtube_id, x_post_id,
      video_title, category, channel_name, actual_channel_name,
      is_unrelated_channel, product_id, product_url, product_brand,
      product_price, product_currency, video_thumbnail_url,
      video_expires_at, storage_path, import_batch_id
    )
    select
      video_url, platform, media_kind, youtube_id, x_post_id,
      video_title, category, channel_name, actual_channel_name,
      is_unrelated_channel, product_id, product_url, product_brand,
      product_price, product_currency, video_thumbnail_url,
      video_expires_at, storage_path, p_batch_id
    from filtered
    on conflict do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  update public.video_import_batches
  set
    status = 'completed',
    records_processed = v_total,
    records_inserted = v_inserted,
    records_skipped_existing = v_total - v_inserted,
    records_failed = 0
  where id = p_batch_id;

  return jsonb_build_object(
    'processed', v_total,
    'inserted', v_inserted,
    'skipped_existing', v_total - v_inserted
  );
end;
$$;

-- CREATE OR REPLACE preserves the service_role-only grant from earlier migrations.
```

**Rollout order:** (1) apply migration, (2) deploy TS changes (config/platforms/validation/form/card), (3) deploy route, (4) add the `product-videos` bucket if opt-in mirroring is enabled, (5) run a backfill smoke test with one saved product page per retailer. Existing YouTube/X rows keep `media_kind = 'embed'` from the column default.

**Verification queries:** confirm `select platform, count(*) from public.catalogue_videos group by 1;` includes new values after a test import; confirm `information_schema` shows the widened CHECK; confirm `select proname from pg_proc where proname = 'import_video_batch'` has one definition with `prosecdef = true`.

### Gaps
- Whether a UNIQUE constraint on `(platform, product_id)` is desirable is a product decision: it prevents two videos per product, which may be wrong if a product has a gallery of clips. The partial unique index above is the stricter option.
- The RPC currently reports `records_failed = 0` always; malformed retail JSON is rejected earlier by Zod, but row-level cast failures (e.g. bad `product_price`) would raise an exception and mark the whole batch failed via the route's catch path — consider a per-row validation stage in SQL if partial success is required.
- No migration tooling configuration was inspected; the note assumes migrations are applied via Supabase CLI or SQL editor as the existing comments instruct.
