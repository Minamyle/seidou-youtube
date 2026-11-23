# Temu as a source of product videos for a saved-HTML → JSON import pipeline (2026)

Research date: 2026-11-19. All "verified" items below were checked directly during this research (live HTTP fetches/HEAD requests or primary-source docs). "Inferred" items are clearly marked. No server-side scraping is assumed; the target pipeline is: user saves HTML in Chrome (`Ctrl+S`, Webpage, HTML Only) → browser-side parser → JSON → Supabase.

## 1. What a saved Temu product/search HTML actually contains

### Takeaway
Temu is **not a Next.js app**: there is no `__NEXT_DATA__` script tag. Raw HTTP responses contain a large SSR "shell" of configuration scripts plus SEO metadata, but **no product media URLs, no `<video>` tags, and no product JSON state**. Product data and media URLs are injected later by client-side JavaScript, so only a save made from a fully loaded/rendered page (after scrolling) has a chance of containing video URLs.

### Cited Findings
- Verified: `https://www.temu.com/search_result.html?search_key=phone%20case` fetched as raw HTML returns `window.__DOC_SOURCE__ = "ssr"`, `window.__PageContext__ = {"pagePath":"w/search_result","buildId":...,"modern":false,...}`, `window.__NPM_PACKAGE_CONFIG__ = {...}`, `window.__CDN_IMG__ = {...}`, `window.__InitialI18nStore__ = {...}`, plus `<link rel="canonical" href="https://www.temu.com/phone-case-5020019975603-s.html">`, `meta og:image`, `meta keywords`, and `meta robots content="noindex"`. No `__NEXT_DATA__`, no `.mp4`, no `<video>`, no `goods_id`/`goods_name`/`thumb_url` product payload in the SSR source. ([Temu search page HTML](https://www.temu.com/search_result.html?search_key=phone%20case))
- Verified: `https://www.temu.com/goods.html?goods_id=601099512345` returns the same shell pattern with `window.__PageContext__ = {"pagePath":"w/seo-goods",...}`; direct grep of the full response found `window.__*`, `kwcdn` (config), but **no** `.mp4`, `<video>`, or `goods_name`. ([Temu goods page HTML](https://www.temu.com/goods.html?goods_id=601099512345))
- Verified: the page self-identifies as bot-detected: `window.__CRAWLER_BY_TITAN__ = "true"` appears in the SSR head. The privacy/cookie config whitelist names anti-bot artifacts (`cf_clearance`, `__cf_bm`, `cf_chl_rc_*`, `TS0132de8b`, `BIGipServerCentinel-Prod-Web-MethodDataCollectorWeb.app~Centinel-Prod-Web_pool`, `forterToken`, `ftr_ncd`, `_nano_fp`) — i.e. Cloudflare + F5 BIG-IP + Forter-style protections. ([Temu page source](https://www.temu.com/search_result.html?search_key=phone%20case))
- Verified: a HEAD/GET with a normal Chrome UA via a non-browser HTTP client returned only a ~2.9 KB response with no title, no product data, whereas the webfetch client (different UA) got the ~100 KB SSR shell. Raw HTTP therefore yields either an empty shell or a challenge page. ([Temu goods page](https://www.temu.com/goods.html?goods_id=601099512345))
- Independent corroboration: "Temu is heavily protected and geo-personalized, so raw HTTP requests get blocked or return empty shells." ([ScrapeUnblocker/temu-scraper README](https://raw.githubusercontent.com/ScrapeUnblocker/temu-scraper/main/README.md))
- Community scrapers use Selenium/headless Chrome and explicitly scroll to load more products, confirming content is client-rendered/lazy-loaded. ([zainchodry/temu-scraper](https://github.com/zainchodry/temu-scraper))
- A browser-only extension can extract price, brand, seller, shipping and ATC URL from a *loaded* Temu product page — i.e. those values exist in the live DOM but not in the raw HTML. ([Temu Quick Scraper](https://stevegates24.github.io/Temu-Quick-Scraper/))
- Verified: Temu has an internal page `https://www.temu.com/afc_preview_video.html?video_url=<url-encoded-direct-mp4>` — evidence that Temu itself plays direct CDN mp4 URLs via a query parameter. Its raw HTML is also just the SSR shell (no `<video>` in source). ([Temu AFC preview video page](https://www.temu.com/afc_preview_video.html))

### Inferences
- A `Ctrl+S` "Webpage, HTML only" save serialises the **current DOM plus inline script state**, not the original server response. Therefore video URLs can appear in a saved file only if the browser had already fetched and inserted them (open the product's gallery/video, scroll the listing, wait for media). If the user saves too early, expect zero video records.
- Because there is no `__NEXT_DATA__`, a parser must be **generic**: scan all `<script>` text, all element attributes, and any parseable JSON blobs for video-looking URLs, rather than following a fixed Next.js path.
- The exact internal state variable that holds product media on a rendered Temu page (e.g. a `window.__InitialState__`/Redux-like object) was **not** verified; recommend a recursive JSON walker keyed on `/video|media|goods|thumb|image|mall|shop|price|title/i`.

### Gaps
- No live browser was available in this session (the OpenCode in-app browser was disconnected), so a real rendered `Ctrl+S` file could not be captured and diffed against the SSR shell. Exact JS state variable names/paths for the product media array remain unverified.
- Whether `<video>` elements use `src`, `<source src>`, or a JS-only player with `blob:`/`MSE` URLs is unverified. (The existence of direct `.mp4` URLs suggests plain `src` is used at least some of the time.)

## 2. CDN/domains hosting Temu product videos and images; URL stability/protection

### Takeaway
Temu product videos are served as **direct, unsigned `.mp4` URLs on `goods-vod.kwcdn.com`**. A verified URL returned HTTP 200, `Content-Type: video/mp4`, `Access-Control-Allow-Origin: *`, with **no X-Frame-Options and no CSP**, and identical results for no Referer, a Temu Referer, and an unrelated-domain Referer — i.e. no token, no expiry parameter, and no observed Referer hotlink block.

### Cited Findings
- Verified HEAD test on 2026-11-19 against `https://goods-vod.kwcdn.com/goods-video/59030d0f18f5a0ee2d88b6e4f592330a9aa47ba0.f30.mp4`: status 200, `Content-Type: video/mp4`, `Content-Length: 2421882`, `Access-Control-Allow-Origin: *`, `Server: cloudflare`, empty `X-Frame-Options` and `Content-Security-Policy`. Repeated with `Referer: https://www.temu.com/` and `Referer: https://example.com/` — identical 200 results in all three cases. ([Tested video URL](https://goods-vod.kwcdn.com/goods-video/59030d0f18f5a0ee2d88b6e4f592330a9aa47ba0.f30.mp4))
- Verified URL shape: `https://goods-vod.kwcdn.com/goods-video/<40-hex-hash>.f30.mp4` (no query string/token/timestamp). The example URL was found in a public post describing a Temu product demo video. ([Facebook post quoting the URL](https://www.facebook.com/groups/1024286344806148/posts/1433777407190371/))
- Verified from Temu's own `window.__CDN_IMG__` config: image CDNs and fallbacks are `img.kwcdn.com` → `img-1.kwcdn.com`, `img-2.kwcdn.com`, `img.temucdn.com`; `aimg.kwcdn.com` → `aimg-1/-2`, `aimg.temucdn.com`; `static.kwcdn.com` → `static-1/-2`, `static.temucdn.com`; plus `rewimg-eu.kwcdn.com`, `avatar-eu.kwcdn.com`, `img-eu.kwcdn.com`, `rewimg.kwcdn.com`, `avatar.kwcdn.com`, `commimg.kwcdn.com` (each with `-1`/`-2`/`.temucdn.com` fallbacks). Verified `og:image` example: `https://aimg.kwcdn.com/upload_aimg/th/17118177-aa57-4cb7-bd96-3dea184a6a83.png`. ([Temu page source](https://www.temu.com/search_result.html?search_key=phone%20case))
- Affiliate/KOL video media uses `commimg.us.kwcdn.com/kol-image-public/...`, seen in a public Temu `afc_preview_video.html?video_url=...` link. ([Instagram post with the link](https://www.instagram.com/stephaniepadillah/p/DW5f70ADdLR/?hl=en))
- Third-party normalized output shows product images as `https://img.kwcdn.com/product/fancy/...` and a `video` field that can be `null`. ([ScrapeUnblocker/temu-scraper README](https://raw.githubusercontent.com/ScrapeUnblocker/temu-scraper/main/README.md)); sample output from another scraper uses `https://img.kwcdn.com/product/fancy/example.jpg`. ([Temu Products Scraper README](https://raw.githubusercontent.com/shahidirfan100/Temu-Products-Scraper/main/README.md))

### Inferences
- The `.f30` suffix is likely a quality/transcoding variant (analogous to other PDD/Kuaishou CDNs); other variants may exist. Not verified.
- Absence of signed query parameters suggests URLs are content-addressed and long-lived rather than expiring tokens; however **long-term stability is not guaranteed** — always persist the resolved URL in JSON and expect some links to 404 later.
- `Access-Control-Allow-Origin: *` plus no frame-ancestors restrictions means the CDN layer will not block cross-origin media playback from a different-domain web app. Any restrictions would come from Temu's site/ToS, not HTTP headers.
- Geoblocking was not tested from multiple countries. Region-specific CDN hosts (`img-eu`, `commimg.us`) imply regional routing; a US-hosted video might behave differently from other regions.

### Gaps
- No proof of how long a `goods-vod.kwcdn.com` URL remains valid after a product is delisted.
- No test of Range requests/HLS variants/mobile-only media; only the single MP4 was checked.
- No verification of whether `goods-vod` URLs served outside a Temu page ever trigger behavioral (not header-based) blocking in a real browser.

## 3. Can the video be played by plain `<video src>` or an iframe?

### Takeaway
**Verified technically: a plain `<video src="https://goods-vod.kwcdn.com/...mp4">` should work cross-origin** — correct MIME type, CORS `*`, and no referer/frame restrictions were observed. **Do not rely on an iframe of a Temu page**: no general product-video iframe embed was verified, and Temu's Terms expressly forbid framing/embedding its site.

### Cited Findings
- Header evidence for direct `<video>`: 200 / `video/mp4` / `ACAO: *` / no `X-Frame-Options` / no CSP, from all three Referer conditions. ([Tested video URL](https://goods-vod.kwcdn.com/goods-video/59030d0f18f5a0ee2d88b6e4f592330a9aa47ba0.f30.mp4))
- Temu's own preview mechanism is `afc_preview_video.html?video_url=<encoded mp4 URL>`, which is consistent with a page wrapping a native video element rather than a proprietary streaming protocol. ([Preview page](https://www.temu.com/afc_preview_video.html); [example link](https://www.instagram.com/stephaniepadillah/p/DW5f70ADdLR/?hl=en))
- Temu Terms of Use §3.5(14) prohibits users from "frame, embed, mirror, or otherwise incorporate any part of the Services, including any webpage, interface, login page, or form, into any third-party website, application, except as expressly permitted by Temu". ([Temu Terms of Use](https://www.temu.com/terms-of-use.html), [text mirror](https://r.jina.ai/https://www.temu.com/terms-of-use.html))
- Temu Terms §7.1 requires prior consent of the content owner before copying/reproducing/displaying Content not owned by the user; §3.5(15) forbids copying or storing a significant portion of Service content without written consent. ([Temu Terms of Use](https://r.jina.ai/https://www.temu.com/terms-of-use.html))

### Inferences
- Recommended playback path: store the resolved CDN URL in Supabase JSON and render `<video controls playsinline preload="metadata" src="<video_url>">` in the consumer app. No custom player, token exchange, or proxy should be necessary for the tested URL class.
- If the saved HTML contains only a Temu page URL (e.g. `afc_preview_video.html?video_url=...`) rather than a direct mp4, decode the `video_url` query parameter and store the decoded mp4 URL.
- Embedded playback of a *Temu page* is both technically risky (anti-bot/CSP may change) and contractually prohibited; avoid it.

### Gaps
- No browser-based playback test was possible in this session (browser disconnected), so actual rendering on a foreign origin is inferred from headers only.
- Whether Temu's own `afc_preview_video.html` can be iframed was checked only via non-browser HEAD (no X-Frame-Options seen), not via a real embedding test.

## 4. Fields that can reliably be extracted (with patterns/paths)

### Takeaway
The most reliable fields from a saved page are **ID/canonical URL and metadata** present in raw HTML; price/title/seller/video are available only from the **rendered DOM**. No fixed product-JSON path is verified, so use multi-strategy extraction with `null` fallbacks.

### Cited Findings
- Verified in raw HTML: `<link rel="canonical" href="https://www.temu.com/phone-case-5020019975603-s.html">`, `meta og:title`, `meta og:image`, `meta keywords` (search key), `<title>`, and `window.__PageContext__` / `window.__CDN_IMG__` / `window.__InitialI18nStore__` JSON-in-script assignments. ([Search page HTML](https://www.temu.com/search_result.html?search_key=phone%20case))
- Product URL/ID formats verified in third-party docs: `https://www.temu.com/goods.html?goods_id=601099512345` and `https://www.temu.com/lt-en/...-g-601101955527840.html`. ([Temu Products Scraper README](https://raw.githubusercontent.com/shahidirfan100/Temu-Products-Scraper/main/README.md); [ScrapeUnblocker README](https://raw.githubusercontent.com/ScrapeUnblocker/temu-scraper/main/README.md))
- Normalized fields available from a rendered product page (per independent tools): `goods_id`, `title`/`name`, `url`, `image_url`/`images`, `price`, `price_formatted`, `original_price`, `discount`, `currency`, `rating`, `review_count`, `sales`, `video` (nullable). ([Temu Products Scraper README](https://raw.githubusercontent.com/shahidirfan100/Temu-Products-Scraper/main/README.md); [ScrapeUnblocker README](https://raw.githubusercontent.com/ScrapeUnblocker/temu-scraper/main/README.md))
- Seller/shop name is extractable client-side (extension field "Seller", e.g. "Creative Craftsmanship"), as are brand, shipping text and ATC URL. ([Temu Quick Scraper](https://stevegates24.github.io/Temu-Quick-Scraper/))
- Verified video-URL regex target: `goods-vod\.kwcdn\.com/goods-video/[a-f0-9]+\.f\d+\.mp4`. ([Tested video URL](https://goods-vod.kwcdn.com/goods-video/59030d0f18f5a0ee2d88b6e4f592330a9aa47ba0.f30.mp4))

### Inferences — concrete parser strategy (browser-side)
1. Parse with `new DOMParser().parseFromString(html, 'text/html')` (works offline on the saved file).
2. `goods_id`: try `new URL(location-from-<link rel=canonical|og:url>).searchParams.get('goods_id')`; else match the canonical/href with `/-g-(\d{9,})\.html/`; else search all `a[href]` for `goods_id=(\d+)`.
3. `canonical_url`: `document.querySelector('link[rel="canonical"]')?.href` → fall back to `meta[property="og:url"]` → fall back to first `a[href*="goods.html?goods_id="]`.
4. `title`: `meta[property="og:title"]` → `<title>` → `meta[name="title"]` → any `h1`. Strip " - Temu" suffix.
5. `thumbnail_url`: `meta[property="og:image"]` → `img[src*="kwcdn"]` inside gallery → recursive JSON keys `thumb_url|image_url|images|goods_img`.
6. `shop_name`: search rendered text/JSON for keys `mall_name|shop_name|seller|store_name`; browser-extension evidence shows it is in the DOM, not the SSR shell.
7. `price`/`currency`: search JSON keys `price|price_str|min_on_sale_price|currency` and visible text `$...`; third-party schemas confirm both numeric and formatted forms.
8. `video_url`: scan **all** script text, attribute values and text nodes for `https?://[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?`, prioritise `goods-vod.kwcdn.com/goods-video/...`; also `<video src>`, `<source src>`, `data-video-url`, `poster`, and decoded `video_url=` params. Emit `video_url: null`, `has_video: false` when absent (third-party output confirms `video: null` is normal).
9. `category`: derive from canonical slug (e.g. `phone-case-...-s.html` → "phone case"); no verified structured category field.
10. Walk any `<script>` assignment of the form `window.__NAME__ = {…};` (notably `__InitialI18nStore__`, `__PageContext__`, `__CDN_IMG__` — verified) and recursively collect candidate strings; do **not** look for `__NEXT_DATA__` (verified absent).

### Gaps
- Exact JSON key paths for the product media array (e.g. `rawData.goodsDetail.video...`) are unverified without a real rendered save.
- Whether shop name/price appear as text nodes or only in JS state (and thus in saved HTML) is unverified.
- Category as a structured field (ID/name) was not verified; slug heuristic only.

## 5. Official APIs / feeds more reliable than saved HTML

### Takeaway
There is an official **seller/partner Open API** (authorization required) and affiliate program pages, but **no public, unauthenticated consumer catalog/product-video API or feed was found**. Third-party paid scrapers/APIs exist but are not Temu-official.

### Cited Findings
- Temu Partner Platform documentation (US/EU/global) describes Open APIs for ERP/sellers: "Build apps using Temu's open APIs to provide sellers with solutions for automating, managing, and growing their businesses on Temu" and "Authorization is an important step to using Open API. ERP need to be authorized by the seller in order to call non-public APIs required for shop management." ([Partner EU docs](https://partner-eu.temu.com/documentation?menu_code=98501210a0cc465695e6d94e364bb83c); [Authorization doc](https://partner.temu.com/documentation?menu_code=38e79b35d2cb463d85619c1c786dd303))
- Signature generation and seller authorization are documented (HMAC-style signed Open API requests). ([Partner US docs](https://partner-us.temu.com/documentation?menu_code=38e79b35d2cb463d85619c1c786dd303&sub_menu_code=2d81829fcbbc4058b95f695440e75236))
- Official Postman workspace exists: "Temu Open Platform on the Postman API Network: This public workspace features ready-to-use APIs, Collections, and more from Temu Open." ([Postman](https://www.postman.com/temu-open/temu-open-platform/overview))
- Product Publishing API V3 (seller-side product management) documented. ([Partner docs](https://partner.temu.com/documentation?sub_menu_code=2bdd2c8933604967a613caa5f87e5963))
- Affiliate/influencer programs are marketing programs, not documented public catalog APIs: [affiliate recruit](https://www.temu.com/affiliate_recruit.html), [affiliate & influencer program](https://www.temu.com/affiliate_influencer_program.html).
- Third-party options: Apify Temu scrapers, JustOneAPI "Temu Homepage Product Feed API", Ecomblade "Temu Product Data API", ScrapeUnblocker — all non-official and typically paid. ([JustOneAPI docs](https://docs.justoneapi.com/en/api/temu/); [Ecomblade](https://ecomblade.com/api/temu/); [Apify](https://apify.com/apivault_labs/temu-product-scraper); [ScrapeUnblocker README](https://raw.githubusercontent.com/ScrapeUnblocker/temu-scraper/main/README.md))

### Inferences
- Seller Open API is scoped to a seller's *own* shop/products; it is not a substitute for arbitrary consumer product videos found via saved HTML.
- For this tool's stated constraints (no server-side scraping, only JSON to Supabase), a direct official API path is not available; saved-HTML parsing remains the only offline-client route.

### Gaps
- Temu affiliate dashboards may expose product/creative feeds to approved affiliates; no public documentation was found in this research.
- No public rate limits, pricing or video-field coverage for the seller Open API were verified.

## 6. robots.txt and ToS stance on scraping/rehosting media

### Takeaway
`robots.txt` is permissive for generic crawlers but restrictive for named bots; the Terms of Use explicitly prohibit scraping, copying/storing significant content, and framing/embedding — so a saved-HTML import must be treated as a personal/private workflow, not a sanctioned content pipeline.

### Cited Findings
- Verified `https://www.temu.com/robots.txt`: blocks for `Googlebot`, `Googlebot-Image`, `Bingbot`, `Google-Extended`, `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`, `ClaudeBot`, `Claude-User`, `Claude-SearchBot`, `AdsBot-Google`, `Applebot`, `Pinterestbot`, `Twitterbot`, `FacebookBot`, `facebookexternalhit` include `DisAllow: /s/`, `/w/`, `/m/`, `/k/`, `/*?*top_goods=*`, `/*-m-*?goods_id=*`, many account/cart paths, and `/*@context*https://schema.org/*`. ([Temu robots.txt](https://www.temu.com/robots.txt))
- The `User-agent: *` block contains only `Allow: /.well-known/` (no blanket `Disallow: /`); `Slurp`, Yahoo! Japan bots and `Bytespider` get `DisAllow: /*`. Sitemap declared: `https://www.temu.com/sitemap-index.xml` (returned 403 on direct fetch during this research). ([Temu robots.txt](https://www.temu.com/robots.txt))
- Terms §3.1: "You agree to use the Services for your personal and non-commercial use, and not on behalf of or for the benefit of any third party." ([Temu Terms of Use](https://r.jina.ai/https://www.temu.com/terms-of-use.html))
- Terms §3.5(12) prohibits "use of manual or automated software or other means to access, 'crawl,' 'scrape,' or 'spider' any page, data, or portion of or relating to the Services"; §3.5(14) prohibits framing/embedding/mirroring; §3.5(15) prohibits "copy or store any significant portion of the content on the Services without written consent from us". ([Temu Terms of Use](https://r.jina.ai/https://www.temu.com/terms-of-use.html))
- Terms §7.1: Content "may be protected by copyright and/or other intellectual property laws"; user undertakes "not to copy, reproduce, modify, translate, publish, broadcast, transmit, distribute, perform, upload, display, license, sell, or otherwise use for any purpose any Content not owned by you without the prior consent of the owner". §7.4 grants only a limited personal non-commercial license; §7.5 forbids commercial use of information from the Services. ([Temu Terms of Use](https://r.jina.ai/https://www.temu.com/terms-of-use.html))
- Third-party scraper READMEs themselves caution users to comply with Temu's terms and applicable law. ([Temu Products Scraper README](https://raw.githubusercontent.com/shahidirfan100/Temu-Products-Scraper/main/README.md))

### Inferences
- robots.txt does not govern manual browser saves, but it signals Temu's preference to control automated indexing; the ToS language on scraping/copying/framing is much broader and directly relevant to any product that republishes or rehosts media.
- Storing only JSON metadata (IDs, titles, URLs) and letting the end user's browser stream the CDN URL is materially different from rehosting the MP4 on your own servers; still, the ToS §7.1/§3.5(15) language is broad enough that the tool should be framed as private/personal use, with no redistribution of media.

### Gaps
- No Temu-specific legal guidance on hotlinking CDN media from a third-party web app was found; this note is a factual summary, not legal advice.
- Regional variations of Terms/robots were not checked.

## 7. Anti-bot protection and whether saved HTML really contains media URLs

### Takeaway
Temu uses layered bot detection (Titan, Cloudflare, F5 BIG-IP, Forter) plus IP/geolocation checks; raw HTTP returns shells/challenges. A manual save from a real logged-in browser can capture rendered media URLs, but only if the media was actually loaded before saving.

### Cited Findings
- Verified: `window.__CRAWLER_BY_TITAN__ = "true"` and the anti-bot cookie whitelist (`cf_clearance`, `__cf_bm`, `cf_chl_rc_i/m/n`, `TS0132de8b`, `BIGipServerCentinel-Prod-Web-MethodDataCollectorWeb.app~Centinel-Prod-Web_pool`, `forterToken`, `ftr_ncd`, `_nano_fp`) in Temu's SSR head. ([Temu page source](https://www.temu.com/search_result.html?search_key=phone%20case))
- Verified: two different HTTP clients received fundamentally different responses (full SSR shell vs ~2.9 KB empty/challenge page) from the same product URL. ([goods.html](https://www.temu.com/goods.html?goods_id=601099512345))
- "Temu checks the network address before it serves a product page… a datacenter address is almost always challenged"; verification/sign-in pages are common, residential/mobile proxies recommended. ([Temu Products Scraper README](https://raw.githubusercontent.com/shahidirfan100/Temu-Products-Scraper/main/README.md))
- "Temu's anti-bot system is aggressive" (scraping community demo, 2025). ([YouTube demo](https://www.youtube.com/watch?v=SSRo-r_3eaI))
- Some community tools require "Manual login to Temu to handle CAPTCHA". ([FarisAshhab/temu-product-scraper](https://github.com/FarisAshhab/temu-product-scraper))
- Headless scrapers must auto-scroll to load more products, indicating lazy loading of listing content. ([zainchodry/temu-scraper](https://github.com/zainchodry/temu-scraper))
- Verified: SSR HTML has no `.mp4`/`<video>` at all, while Temu's own preview mechanism accepts direct mp4 URLs — so media URLs are introduced client-side after data fetch. ([search page](https://www.temu.com/search_result.html?search_key=phone%20case); [preview page](https://www.temu.com/afc_preview_video.html))

### Inferences
- A real browser with normal cookies/IP is the intended path for the human user; the anti-bot stack mainly affects automated HTTP clients, not a person saving their own page.
- Because media is client-injected, the "scroll so media loads" instruction in the task is essential; even then, a video behind a click-to-play overlay may not have its URL materialised unless the gallery/video was interacted with. Best UX: instruct users to open each product's video once, then save.
- If a saved file contains no `.mp4` string at all, the parser should emit metadata-only records with `video_url: null` rather than fabricate URLs.

### Gaps
- No captured real-user saved HTML was available, so the exact DOM location/attribute of the video URL in a saved file is unverified.
- Effect of logged-in vs guest session, mobile vs desktop site, and region on video URL availability was not tested.
