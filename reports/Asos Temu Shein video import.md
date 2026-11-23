# Extend the importer to retailer product videos

**Yes — all three can feed the same `catalogue_videos` table, but only Temu has a verified, directly playable media URL today.** The work is a modest extension of the pipeline you already have: add three values to `SUPPORTED_PLATFORMS`, branch the display on `mediaKind`, and add one forward migration — the browser still converts saved HTML to JSON and Supabase still receives only JSON. The hard part is not the plumbing, it is the input: unlike YouTube and X, these retailers expose **no public embed/player API**, inject product media with client-side JavaScript, and serve video from retailer CDNs that are not stable hosts. That means the quality of the user's saved HTML decides whether a record contains a usable video URL at all, and a correctly imported row can still render black or broken if the display app has no branch for it — exactly the failure you hit with X. Treat **data/import correctness** and **display/playback** as two separate deliverables, and treat retailer video URLs as ephemeral metadata, never as durable assets.

## Temu is importable today; SHEIN is conditional and ASOS is speculative

The three sites sit on a steep feasibility slope, and the difference is almost entirely about whether a direct MP4 has been observed. **Temu is the clear winner**: a HEAD check on 19 Nov 2026 against `https://goods-vod.kwcdn.com/goods-video/59030d0f18f5a0ee2d88b6e4f592330a9aa47ba0.f30.mp4` returned **HTTP 200, `Content-Type: video/mp4`, `Access-Control-Allow-Origin: *`, no `X-Frame-Options` and no CSP**, with identical results for no Referer, a Temu Referer and an unrelated-domain Referer ([tested video URL](https://goods-vod.kwcdn.com/goods-video/59030d0f18f5a0ee2d88b6e4f592330a9aa47ba0.f30.mp4)). The URL shape `goods-vod.kwcdn.com/goods-video/<40-hex-hash>.f30.mp4` carries no token or expiry parameter, and Temu's own `afc_preview_video.html?video_url=<encoded mp4>` page confirms it plays direct CDN files in a native player ([preview page](https://www.temu.com/afc_preview_video.html)). **SHEIN is a middle case**: images on `img.ltwebstatic.com` are publicly readable with CORS `*` and long cache lifetimes (a verified HEAD returned 200, `image/jpeg`, `max-age=691200`, `Access-Control-Allow-Origin: *`) ([verified image HEAD](https://img.ltwebstatic.com/v4/j/pi/2026/05/02/f8/17776852344d34295349aad8f43f4fbd32e5a672d8_thumbnail_405x552.jpg)), but the `video_link` that SHEIN scrapers report is **not an MP4** — it is a ~253 KB HTML "Vimeo player" webapp at `api-shein.shein.com/h5/playVimeo?video_url=<hash>.mp4` that resolves the real source in JavaScript at runtime ([verified HEAD](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4); [player page source](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4)). **ASOS is the weakest**: no direct media URL was observable at all, no public ASOS product API was found, and its only verified video stack — ASOS Live — is app-only and Bambuser-powered, where playback is driven by `showId`/`videoId` and deeplinks that "will become invalid if the video content for a specific show is changed" ([ASOS Live](https://www.internetmatters.org/advice/apps-and-platforms/online-shopping/asos-live); [Bambuser/ChatGPT integration](https://internetretailing.net/asos-brings-shoppable-video-content-to-chatgpt-in-uk-first); [Bambuser Player API](https://bambuser.com/docs/live/player-api-reference)).

| Site | Verdict | Verified | Inferred / missing |
|------|---------|----------|--------------------|
| **Temu** | Feasible; best case for video | Unsigned MP4 on `goods-vod.kwcdn.com`, 200/`video/mp4`/CORS `*`, no referer or frame blocking; direct-MP4 preview mechanism ([test](https://goods-vod.kwcdn.com/goods-video/59030d0f18f5a0ee2d88b6e4f592330a9aa47ba0.f30.mp4)) | Where the MP4 sits in a *rendered* save is unverified; SSR HTML has no `.mp4`; link longevity after delisting unknown |
| **SHEIN** | Metadata yes; direct MP4 unconfirmed | Images on `img.ltwebstatic.com` public/CORS `*`; `video_link` is a `playVimeo` HTML page, not a file ([source](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4)) | No captured resolved MP4 behind `playVimeo`; unknown host/signature/expiry/referer rules; saved HTML may hold only a poster and a video hash |
| **ASOS** | Speculative; metadata + link-out | PDP IDs are `/prd/<digits>` in the product sitemap ([sitemap](https://r.jina.ai/https://www.asos.com/product-sitemap-com-x.xml)); no public API ([scraper vendor](https://github.com/epctex-support/asos-scraper)); video is app-only/Bambuser | No confirmed ASOS video CDN or direct MP4; JSON-LD/state paths unverified; video may be sparse, regional or experiment-gated |

A practical consequence: for Temu the importer can emit a genuinely playable `videoUrl`; for SHEIN it should emit a `video_player_url` lead plus an image poster and a link-out; for ASOS it should emit product metadata and a retailer link, treating any video URL as a bonus found opportunistically in a real saved file. All three must be comfortable emitting `video_url: null` or metadata-only rows rather than inventing a URL — the research confirms that a normal server response contains no product media at all.

## These sites inject media with JavaScript, and no embed API saves you

The YouTube/X path works because a saved page contains stable identifiers — an 11-character YouTube ID or a numeric X status ID — that map to a documented embed URL, and the current `VideoCard` simply calls `detectVideoPlatform(video.videoUrl)` to build either `youtube.com/embed/<id>` or `platform.twitter.com/embed/Tweet.html?id=<id>` ([`components/video-card.tsx`](../components/video-card.tsx)). The retailers offer no equivalent: no ASOS iframe or oEmbed endpoint was found, no general Temu product embed was verified (and its Terms forbid framing), and SHEIN's player is an internal H5 webapp, not a published embed contract. **A stable ID → stable player URL conversion does not exist here**, so the importer must capture the *resolved media URL itself*, not an ID.

Every retailer delivers a JavaScript application shell whose raw HTML contains no product JSON or `<video>` tags. Temu's SSR response carries `window.__DOC_SOURCE__ = "ssr"`, `window.__PageContext__`, `window.__CDN_IMG__`, canonical and OG metadata, but **no `.mp4`, no `<video>` and no `goods_name`**, and it self-identifies as bot-detected via `window.__CRAWLER_BY_TITAN__ = "true"` ([Temu search HTML](https://www.temu.com/search_result.html?search_key=phone%20case)). SHEIN's direct fetch returns only shell config and anti-bot scripts (`antiin`, `csrandom`, `risk_streamline`), with no `__INITIAL_STATE__`, `__NEXT_DATA__`, `gbRawData`, JSON-LD or `.mp4` ([SHEIN product fetch](https://us.shein.com/product-p-515174062.html)). ASOS's rendered view yields a title plus ~1,200 lines of navigation/footer and no price, colour, image or video URLs ([ASOS PDP via Jina](https://r.jina.ai/https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221)). Because "Webpage, HTML only" serialises the **post-JS DOM**, a save only contains what JavaScript actually wrote into the page — so the user must open the gallery, play the video once and scroll **before** Ctrl+S, or the file will hold an empty player shell. For ASOS, anti-bot is moreover empirical: direct datacenter fetches timed out on every attempt (webfetch, `curl.exe`, three proxies) while a text proxy succeeded ([ASOS robots via proxy](https://r.jina.ai/https://www.asos.com/robots.txt)) — which is why no server-side fallback should ever be added to this tool.

This is also where the X black-screen lesson applies. A row can be imported **correctly** — valid JSON, accepted by the RPC, present in `catalogue_videos` — and still display nothing because the consumer app never learned how to render the new platform. The current card treats anything `detectVideoPlatform` cannot recognise as "Invalid video URL"; without a `direct-file` branch, every retailer row lands there. The fix is a rendering capability (`mediaKind`) carried in the record and honoured by the card, not a change to import validation. Note too that retailer CDNs are not stable hosts: ASOS deeplinks can be invalidated, SHEIN video URLs appear signed/region-bound (geo-DNS on `video.ltwebstatic.com`, Aliyun OSS endpoints with signatures) and Temu links have no documented lifetime ([Netify](https://www.netify.ai/resources/hostnames/video.ltwebstatic.com); [urlscan](https://api.urlscan.io/result/1fbbd424-e568-4ecc-a0f7-cfcdc856da3d)). **Persist the resolved URL, expect some links to 404 or 403 later, and never use the media URL as identity.**

## Widen the platform list and keep one flat, product-aware record

The cleanest design is the one the repo already invites: extend the data, not the schema shape. `lib/video-import/config.ts` defines `SUPPORTED_PLATFORMS = ["youtube", "x"] as const`, and that tuple already feeds the Zod enum, `PLATFORM_LABELS` (typed as `Record<VideoPlatform, string>`), `platformCounts` and the SQL whitelist ([`config.ts`](../lib/video-import/config.ts), [`platforms.ts`](../lib/video-import/platforms.ts), [`validation.ts`](../lib/video-import/validation.ts)). Widening it to five values propagates everywhere and makes TypeScript demand labels for each new platform. A Zod discriminated union is technically available but the wrong shape: the import form, preview, export and RPC all consume one flat object, so a union would force a large rewrite for no benefit.

```ts
// lib/video-import/config.ts
export const SUPPORTED_PLATFORMS = ["youtube", "x", "asos", "temu", "shein"] as const
export type VideoPlatform = (typeof SUPPORTED_PLATFORMS)[number]
export const RETAIL_PLATFORMS = ["asos", "temu", "shein"] as const
export type RetailPlatform = (typeof RETAIL_PLATFORMS)[number]

// lib/video-import/platforms.ts
export const PLATFORM_LABELS: Record<VideoPlatform, string> = {
  youtube: "YouTube", x: "X (Twitter)", asos: "ASOS", temu: "Temu", shein: "SHEIN",
}
export function getMediaKind(platform: VideoPlatform): "embed" | "direct-file" {
  return (RETAIL_PLATFORMS as readonly string[]).includes(platform) ? "direct-file" : "embed"
}
```

Keep `VideoData` flat and add optional fields, so CSV export and the upload components that read `category, channelName, videoUrl, videoTitle` directly keep working ([`lib/types.ts`](../lib/types.ts), [`components/export-buttons.tsx`](../components/export-buttons.tsx)). Add a `RetailProductMeta` block for identity and provenance, and add `mediaKind` as a **derived** field — recompute it from `platform` during validation rather than trusting user JSON. A robust record looks like this, with product identity separated from the volatile media URL:

```ts
// lib/types.ts
export type VideoMediaKind = "embed" | "direct-file"
export interface RetailProductMeta {
  productId: string          // ASOS /prd/<digits>, Temu goods_id, SHEIN goods_id or SKU
  productUrl: string         // stable canonical product link — identity/display anchor
  brand?: string
  price?: string
  priceCurrency?: string
  thumbnailUrl?: string | null
  videoPlayerUrl?: string | null  // SHEIN playVimeo / ASOS Bambuser deeplink, if found
  videoExpiresAt?: string | null  // ISO timestamp when signed URL expiry is known
}
export interface VideoData {
  category: string; channelName: string; videoUrl: string; videoTitle: string
  actualChannelName?: string; isUnrelatedChannel?: boolean
  platform?: VideoPlatform; mediaKind?: VideoMediaKind; product?: RetailProductMeta
  storagePath?: string | null  // set only if bytes are ever mirrored into Supabase Storage
}
```

Parsing stays pure string/JSON logic — no `fetch`, no `DOMParser` — so the exact code runs in the browser form and in Vitest, matching the existing `parseHtmlImport` design in `lib/video-import/html.ts` ([`html.ts`](../lib/video-import/html.ts), [`html.test.ts`](../lib/video-import/html.test.ts)). Split the orchestrator into a shared `retail/` directory with one thin adapter per site and shared JSON-LD/`<video>` extractors, and call it only when the saved page's canonical URL or `<base>` host matches an allowlisted retailer host — mirroring the `looksLikeXPage()` guard that stops X pages leaking YouTube links:

```text
lib/video-import/
  config.ts            # extended platforms, fields, bucket constants
  platforms.ts         # detectVideoPlatform, PLATFORM_LABELS, getMediaKind
  html.ts              # orchestrator: X + YouTube + retail parsers
  retail/
    types.ts  jsonld.ts  media.ts  schema.ts  index.ts
    asos.ts  temu.ts  shein.ts     # host check + product-ID regex + overrides
    asos.test.ts  temu.test.ts  shein.test.ts
```

The extractors are opportunistic cascades, never single-source. JSON-LD comes first — walk every `script[type="application/ld+json"]` block, including `@graph` arrays, for `@type: Product` (`name`, `sku`, `productID`, `brand.name`, `offers.price`, `offers.priceCurrency`, `image`, `video`) and `VideoObject` (`contentUrl`, `embedUrl`, `thumbnailUrl`, `expires`) ([schema.org Product](https://schema.org/Product), [VideoObject](https://schema.org/VideoObject)). Then scan `<video src>`, `<source src type>`, `poster`, `data-video-url`, `og:image` and `<link rel="canonical">`, and finally regex all inline script text for `https?://[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?`, `.m3u8`, `goods-vod\.kwcdn\.com/goods-video/[a-f0-9]+\.f\d+\.mp4` and `video_url=` parameters — decoding the `video_url` query param when only Temu's preview link or SHEIN's `playVimeo` link is present. Product IDs are the one cross-site certainty: ASOS `/\/prd\/(\d{6,})/` (legacy `productid=(\d+)`) from the sitemap ([sitemap](https://r.jina.ai/https://www.asos.com/product-sitemap-com-x.xml)); Temu `goods_id=...` or `/-g-(\d{9,})\.html/` ([scraper docs](https://raw.githubusercontent.com/shahidirfan100/Temu-Products-Scraper/main/README.md)); SHEIN `/-p-(\d+)\.html/` ([product URL](https://us.shein.com/product-p-515174062.html)). Because Temu has no `__NEXT_DATA__` (verified absent) and SHEIN's useful state lives in JS variables like `window.gbRawData` that a plain HTML save does **not** capture ([2scraper README](https://github.com/2scraper/shein-scraper)), add a recursive walker over `window.__NAME__ = {…}` assignments keyed on `/video|media|goods|thumb|image|mall|shop|price|title/i`, but treat it as a best-effort probe, not a contract.

Validation must change from **URL-pattern-centric** to **product-centric**. Today `videoRecordSchema` rejects any URL that `detectVideoPlatform` does not recognise ("must be a YouTube or X (Twitter) video link"), keeps `KNOWN_JSON_FIELDS` short (so new fields would be ignored with a warning), and initialises `platformCounts` literally as `{ youtube: 0, x: 0 }` — which would silently produce `undefined` counts for new platforms ([`validation.ts`](../lib/video-import/validation.ts)). The fix is a base record schema plus a `refineRetailRecord` step using the existing Zod 3 `.superRefine()`/`new URL()` style (the project pins `zod` 3.25.76), with an allowlist of retailer hosts and explicit handling of signed URLs:

```ts
// lib/video-import/retail/schema.ts (Zod 3.25-compatible, condensed)
export const RETAIL_HOSTS = {
  asos: ["asos.com", "www.asos.com"],
  temu: ["temu.com", "www.temu.com"],
  shein: ["shein.com", "www.shein.com", "us.shein.com"],
}
export function looksSigned(value: string): boolean {
  const u = new URL(value)
  return ["token", "sig", "signature", "expires", "exp", "x-amz-signature", "auth"]
    .some((k) => u.searchParams.has(k))
}
// refineRetailRecord requires product.productId + product.productUrl,
// checks the product host against RETAIL_HOSTS, requires videoExpiresAt for
// signed videoUrl, requires priceCurrency when price is present, and sets mediaKind.
```

Keep dedupe on `platform:externalId`, but derive `externalId` from **stable identity**, never the raw media URL: for retailers use the product ID (plus a normalised hash of the resolved URL path if you need multiple clips per product), stripping query strings and fragments so a rotated CDN token cannot create a duplicate. This avoids the trap where the same product with a new signature imports twice. One product decision remains open from the research: whether `channelName` should be the brand, the retailer name or `Unknown Channel` — the UI currently labels it "Channel Name" and uses `isUnrelatedChannel` in ways that have no clear meaning for products. Settle that before shipping the form help text.

## A forward migration and a video-aware card finish the plumbing

The database change is one forward migration on the **import catalogue only** — do not touch any Mux-managed `videos` table. The existing migrations create `catalogue_videos`, a `catalogue_videos_platform_check` constraint limited to `('youtube','x')`, unique indexes on `video_url`/`youtube_id`/`x_post_id`, and a `service_role`-only `import_video_batch(uuid, jsonb)` RPC; `video_import_batches.platforms` is already `text[]` ([initial migration](../supabase/migrations/20261021100000_video_import.sql), [X migration](../supabase/migrations/20261029120000_add_x_video_support.sql)). A new `supabase/migrations/20261119120000_add_ecommerce_video_support.sql` widens the check, adds nullable retail columns and recreates the RPC with the new whitelist — `CREATE OR REPLACE` preserves the existing grants:

```sql
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

alter table public.catalogue_videos drop constraint if exists catalogue_videos_platform_check;
alter table public.catalogue_videos add constraint catalogue_videos_platform_check
  check (platform in ('youtube', 'x', 'asos', 'temu', 'shein'));

create unique index if not exists catalogue_videos_retail_product_key
  on public.catalogue_videos (platform, product_id) where product_id is not null;
```

The replacement RPC should widen its platform whitelist at both the validation check and the `incoming` CTE (`case when r.platform = 'youtube' then r.external_id end as youtube_id`, `case when r.platform = 'x' … as x_post_id`), map the retail JSON keys (`media_kind`, `product_id`, `product_url`, `product_brand`, `product_price::numeric`, `upper(product_currency)`, `video_thumbnail_url`, `video_expires_at::timestamptz`, `storage_path`), and add `or (i.product_id is not null and v.platform = i.platform and v.product_id = i.product_id)` to its de-dupe `where not exists`. On the TypeScript side, `app/api/video-import/route.ts` needs no new server fetch: extend its `records` mapping with the same snake_case fields before calling the RPC ([`route.ts`](../app/api/video-import/route.ts)), initialise counts from `SUPPORTED_PLATFORMS` in `validation.ts`, add the three labels, and update the form help text that currently says only "YouTube and X (Twitter) video links are both supported" ([`json-video-import-form.tsx`](../components/video-import/json-video-import-form.tsx)). Keep the JSON-only boundary intact; no retailer HTML or media bytes ever reach the server.

Finally, branch the display on capability so a valid import does not render black. Extend `VideoCard` to a three-way choice — YouTube iframe, X iframe, native `<video>` for `direct-file` — with the retailer `<video>` using `controls playsInline preload="metadata"`, a `poster` from `product.thumbnailUrl`, `referrerPolicy="no-referrer"`, and a graceful fallback for expired or missing media:

```tsx
// components/video-card.tsx — branch logic (condensed)
const detected = detectVideoPlatform(video.videoUrl)
const platform = video.platform ?? detected?.platform ?? null
const mediaKind = video.mediaKind ?? (platform && RETAIL_PLATFORMS.includes(platform as RetailPlatform) ? "direct-file" : "embed")
const expired = video.product?.videoExpiresAt != null && Date.parse(video.product.videoExpiresAt) <= Date.now()
// embed → iframe as today; direct-file && !expired → <video><source src={video.videoUrl} type="video/mp4" /></video>
// else → "Media link expired — re-import this product" / "View on retailer" link-out
```

Show a `PLATFORM_LABELS[platform]` badge and a small product block (brand, price/currency, canonical link) under the title. Be aware that `VideoGrid` keys cards by `video.videoUrl` ([`video-grid.tsx`](../components/video-grid.tsx)), so volatile signed URLs cause remounts — another reason to key on stable identity. If you ever add opt-in mirroring to a private `product-videos` Storage bucket, keep signed URLs short-lived and generated at read time by a JSON-only route, never persisted; and note that a signed URL cannot be individually revoked ([Supabase signed downloads](https://supabase.com/docs/guides/storage/serving/downloads)). For now, pure hotlinking keeps the "only JSON to Supabase" promise intact.

## Storing links beats rehosting, but no retailer licenses this use

None of the three Terms grants a right to copy or rehost product video, and this section is a **factual risk assessment, not legal advice** — re-check the current terms at implementation time. ASOS's Terms prohibit "automated systems or software to extract data" ("screen scraping"), say content may be stored/displayed "only for your own personal use", forbid commercial use without express permission, and state the site "must not be framed on any other site without our permission" ([ASOS Terms](https://www.asos.com/terms-and-conditions/)). Temu's Terms §3.5(12) bans crawling/scraping, §3.5(14) bans "frame, embed, mirror, or otherwise incorporate any part of the Services … into any third-party website, application", §3.5(15) bans copying or storing a significant portion of content without written consent, and §7.1 bans using Content not owned by you without the owner's prior consent ([Temu Terms](https://www.temu.com/terms-of-use.html)). SHEIN's EUR Marketplace terms are starkest: product content including "videos" is owned by "the Seller of the relevant Product", use is "solely for personal and private use", and it may not be "downloaded, copied, reproduced, distributed, transmitted, broadcast, displayed, sold, licensed or otherwise exploited" without prior written consent ([SHEIN EUR GCU §6.1](https://m.shein.com/eur/Terms-and-Conditions-a-399.html)); its US terms add a personal non-commercial licence and ban commercial use of Content ([SHEIN US Terms](https://m.shein.com/us/Terms-and-Conditions-a-399.html?lang=us)). robots.txt is more permissive for ASOS and SHEIN product paths and effectively closed for generic agents on Temu, but robots.txt is a traffic convention, not a licence ([ASOS robots](https://www.asos.com/robots.txt), [Temu robots](https://www.temu.com/robots.txt), [SHEIN robots](https://www.shein.com/robots.txt), [Google's robots intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro)).

Copyright ownership is fact-specific and usually sits with the creator, employer or commissioning party, or — on SHEIN's marketplace — the seller ([WIPO FAQ](https://www.wipo.int/en/web/copyright/faq-copyright), [US Copyright Office](https://www.copyright.gov/engage/photographers), [WCT Art. 8](https://www.wipo.int/edocs/pubdocs/en/wipo_pub_226.pdf)). Downloading a file into Supabase Storage creates a copy plus a communication to the public, the clearest exposure; hotlinking avoids the copy but still publishes the work and remains brittle because CDNs routinely enforce Referer allowlists, signed/expiring URLs, IP/geo rules and embed-origin allowlists ([AWS](https://aws.amazon.com/blogs/security/how-to-prevent-hotlinking-by-using-aws-waf-amazon-cloudfront-and-referer-checking), [Cloudflare Stream](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream), [Alibaba CDN](https://www.alibabacloud.com/help/en/cdn/user-guide/access-control-overview)). CORS is not the blocker for `<video>` display — access policy is. The only permissioned route found is affiliate feeds: joining Awin gives an explicit licence to use feed-supplied images and banners and to deep-link, but the feed fields are `image_link`/`additional_image_link`/`lifestyle_image_link`, **not video files** ([Awin image licence FAQ](https://success.awin.com/s/article/Can-I-use-any-images-from-the-advertiser-s-website?language=en_US), [Awin feed docs](https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1)); ASOS, SHEIN and Temu all run programmes, but no public doc confirmed video in their creatives ([Awin SHEIN](https://ui.awin.com/merchant-profile/15920), [Temu affiliate FAQ](https://www.temu.com/affiliate_question.html)). Temu's DSA research portal is free but expressly not for commercial products ([portal terms](https://partner-eu.temu.com/temu_data_access_portal_terms_of_use)).

| Rank | Approach | Why | Verdict |
|------|----------|-----|---------|
| 1 — lowest | **Affiliate feed + deep link** | Permissioned product data/images, commercial relationship, tracked links; no video field though | Preferred for a durable catalogue; pair with optional saved-HTML video as a bonus |
| 2 — medium | **Read-only metadata JSON + attribution, no bytes** | Smaller copyright footprint; ASOS's linking clause permits fair, non-commercial links | Ship this, framed as personal/private use with clear attribution |
| 3 — high | **Hotlink retailer CDN video in-app** | No copy made, but "embed/mirror" terms may be breached and links can 403 at any time | Best-effort only, with poster and "View on retailer" fallback |
| 4 — highest | **Download and rehost MP4s on Supabase Storage** | Copy + public communication of a third-party work with no licence found; takedown and cost exposure | Do not do without written permission from the rights holder (often the seller on SHEIN) |

A manual browser save is not "automated scraping" in the literal ToS wording, but the output is structured data for a separate app, so the commercial-use, "own database" and "personal use only" clauses are the sharper risk. Store only non-personal product fields — SKU, title, price, category, media URL — and avoid capturing reviewer names, seller identities or UGC creator handles, which would pull in GDPR and Nigeria's NDPA 2023 obligations if EU or Nigerian users are involved ([NDPA 2023](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf)). Document in-app what is extracted, that media stays the retailer's property, that playback is best-effort and may stop, and that users must check current terms and get permission before commercial reuse.

## Build the scaffold now; real saved pages and permissions come later

Phase 1 needs **no retailer HTML samples** and can start immediately. Land the config/platform/type widening, labels, `getMediaKind`, the `retail/` parser skeleton with the JSON-LD and `<video>` extractors, the `refineRetailRecord` validation rules, the dedupe normalisation, the forward migration and RPC, and the three-way `VideoCard` branch with unit tests using **hand-written inline fixtures** built from the verified field names and URL patterns above. Include regression guards that the existing X/YouTube fixtures still pass, that an out-of-allowlist host emits no retail record, that a signed URL without `videoExpiresAt` is rejected, and that `mediaKind: "embed"` on a SHEIN record is normalised to `"direct-file"`. This phase yields a pipeline that imports product **metadata** correctly and never renders a black tile, even before a single real retailer page is parsed.

Phase 2 is blocked on you supplying **real, post-scroll, saved HTML files** — one product page per site, ideally plus a Temu listing and a SHEIN category page — because the single largest gap is that no actual saved-page fixture was obtainable during research. Those files let us confirm whether JSON-LD survives the save, the exact DOM location of the video URL, the product-media state variable names, and whether a direct `.mp4` is present at all. Temu's parser can then be validated against a real `goods_id` page; SHEIN against a real PDP to see whether a resolved MP4 or only a `playVimeo` hash is captured; ASOS against a consented, logged-in save to grep for `ld+json`, `__NEXT_DATA__`, `.mp4`, `m3u8`, `videoUrl`, `media`, `bambuser`. If a site's save contains no video URL, the honest outcome is a metadata-only row and a link-out — not a fabricated media field.

Phase 3 is about permission and durability, not code: join the affiliate programmes if you want a sanctioned product feed and licensed image URLs, and seek written consent before any rehosting. Until then, treat the app as a private catalogue of metadata and best-effort links, with a quick takedown/removal path. The unresolved gaps to keep on a visible list are: **no real saved-page HTML fixtures**; **no confirmed ASOS video CDN or direct MP4** (and no evidence its JSON-LD/state paths exist); **no confirmed SHEIN direct MP4 resolution** behind `playVimeo`; unknown ASOS/Temu/SHEIN CDN URL lifetime, hotlink and geo behaviour; unknown exact signature parameter names for `looksSigned`; and the unsettled `channelName` and "one clip vs many per product" product decisions.

## Conclusion

The strategic shift is from "convert an ID into a player URL" to "capture a volatile media URL and a stable product identity, then branch the renderer on capability." That reframing makes the X-style black-screen failure a non-event for retailer rows and keeps the JSON-only Supabase boundary intact; it also makes the absence of a fixed retailer CDN template a non-blocker, because the importer stores whatever URL the saved HTML actually contains. What remains genuinely uncertain is not the architecture but the inputs and the permission: Temu has a verified playable URL class today, SHEIN and ASOS do not, and none of the three grants a licence to republish their media. Build the scaffold and the metadata path now, use real saved pages to decide how much video each site can honestly contribute, and use affiliate access — not rehosting — if the catalogue ever needs to be durable and commercial.
