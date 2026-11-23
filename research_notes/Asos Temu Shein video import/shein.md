# SHEIN as a source of product videos for a browser-side "saved HTML → JSON" import pipeline (as of 2026-11-19)

## 1. What does a saved SHEIN product page HTML contain (embedded JSON state, `<video>`, .mp4 URLs)?

### Takeaway

A plain HTTP fetch of a SHEIN product URL returns a JavaScript application shell (header/CSS, CDN config, anti-bot SDK scripts) **with no product JSON, no `<video>` element and no `.mp4` URL in the served HTML**; product data is injected by client-side JS. A user's Ctrl+S "Webpage, HTML Only" save serialises the *post-JS DOM*, so any JSON-LD `<script>` injected into the DOM is captured, but JS-only state such as `window.gbRawData` is **not** captured by a plain HTML save.

### Cited Findings

- Direct fetch of `https://us.shein.com/product-p-515174062.html` on 2026-11-19 returned HTML containing only the site shell: `<meta name="site-info">`, inline `GLOBAL_SN_OEST` bootstrap, CSS, and CDN/SDK script tags; grep of the full returned document found **no** `__INITIAL_STATE__`, `__NEXT_DATA__`, `gbRawData`, `application/ld+json`, `video_url`, `.mp4`, `goods_id` or `<video>` strings — [Product page, direct HTML fetch (verified)](https://us.shein.com/product-p-515174062.html)
- The same fetched shell explicitly loads anti-bot/runtime scripts: `//sc.ltwebstatic.com/she_dist/armor-libs/antiin/antiin.1.9.1.min.js`, `//armor.ltwebstatic.com/.../csrandom.1.1.0.min.js`, `risk_streamline-3a6df957bf49f4c5.js`, plus config keys `PUBLIC_CDN: "//sc.ltwebstatic.com"` and `ARMOR_CDN: "//armor.ltwebstatic.com"` — [Product page, direct HTML fetch (verified)](https://us.shein.com/product-p-515174062.html)
- One open-source scraper states that SHEIN listing pages carry product data in `window.gbRawData` while product pages expose it via schema.org JSON-LD; this is why it uses a real browser rather than raw HTML alone — [2scraper/shein-scraper README](https://github.com/2scraper/shein-scraper)
- A second project documents that fetching a SHEIN mobile product shell may return a risk page (`.../risk/challenge?captcha_type=909...`), and that useful data comes from shell config values (`langPath`, `appLanguage`, `currency`, `csrf_token`, `SIG_FILE_NAME`, `RISK_SDK_CONFIG`), not from the product HTML itself — [airhick/shein_scrapper HOW_IT_WORKS.md](https://raw.githubusercontent.com/airhick/shein_scrapper/main/HOW_IT_WORKS.md)
- That project calls a signed mobile BFF endpoint `https://m.shein.com/bff-api/product/get_goods_detail_static_data_v2` with parameters `_ver=1.1.8`, `_lang`, `goods_id`, `mall_code=1`; response fields include `info.productInfo.goods_name`, `info.productInfo.allColorDetailImages[goods_id]`, `info.productInfo.currentSkcImgInfo`, `goods_img`, `goods_thumb` — [airhick/shein_scrapper HOW_IT_WORKS.md](https://raw.githubusercontent.com/airhick/shein_scrapper/main/HOW_IT_WORKS.md)
- A commercial scraper's documented SHEIN output includes `has_video` and a `video_link`, but that link is an API player URL, not an `.mp4` file — [Apify Shein Product Scraper](https://apify.com/omkar-cloud/shein-product-scraper)

### Inferences

- For the user's exact workflow (scroll, then Ctrl+S → "Webpage, HTML only"), the saved file will contain the rendered DOM: text, `<img>` tags with CDN URLs, and likely `<script type="application/ld+json">` on a product page. It will **not** contain `window.gbRawData` (a JS variable, not DOM), so category/listing pages saved this way may yield few or no structured product records.
- The parser should therefore be **multi-strategy and defensive**: (1) parse JSON-LD `Product` nodes; (2) parse DOM `<img src/data-src>` and `<video>/<source src>` attributes; (3) regex the raw HTML for `https?://...\.mp4` and for SHEIN CDN hostnames; (4) fall back to `-p-(\d+)\.html` URL parsing for the goods ID.
- "Scrolling so media loads" matters because SHEIN uses lazy-loading (`lazyload` / `data-src` patterns are visible in its own resource SDK JS) — [SHEIN H5 resource SDK in playVimeo page source (verified)](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4)

### Gaps

- No actual user-produced Ctrl+S file from a real (cookies/authenticated) SHEIN session was available for inspection; the exact post-JS DOM structure and the precise attribute that holds a video URL are therefore unverified.
- It is not verified whether current SHEIN PDPs use a native `<video src=...>` tag, a `<source>` child, or a `<div>` custom player with the URL only in JS state. The report writer should treat "video URL present in saved DOM" as a maybe, not a certainty.
- No saved category/listing HTML was available to confirm whether any product data at all survives into the saved file.

## 2. Which CDN/domains host SHEIN product videos and images? Stability, signatures, hotlinking, geo

### Takeaway

Images are overwhelmingly on `img.ltwebstatic.com` / `img.shein.com` and were verified to be publicly readable with `Access-Control-Allow-Origin: *` and long cache lifetimes. Video delivery is spread across several `*.ltwebstatic.com` video subdomains (Akamai/Cloudflare) and at least some Aliyun OSS endpoints; URLs are not guaranteed stable or unexpiring, and should be treated as volatile.

### Cited Findings

- Known SHEIN CDN subdomains include `img.ltwebstatic.com`, `video.ltwebstatic.com`, `cvideo.ltwebstatic.com`, `svideo.ltwebstatic.com`, `file.ltwebstatic.com`, `sc.ltwebstatic.com`, `sheinh5.ltwebstatic.com`, `shein.ltwebstatic.com`, `armor.ltwebstatic.com` — [dns.ninja ltwebstatic.com lookup](https://dns.ninja/en/dns-lookup/com/ltwebstatic); [Netify svideo/video hostname info](https://www.netify.ai/resources/hostnames/video.ltwebstatic.com)
- `video.ltwebstatic.com` is associated with SHEIN, resolves to ~377 Akamai IPs and uses DNS-based geolocation to return region-specific edge IPs — [Netify hostname info](https://www.netify.ai/resources/hostnames/video.ltwebstatic.com)
- `svideo.ltwebstatic.com` and `shein.ltwebstatic.com` are CNAME'd to Cloudflare (`*.cdn.cloudflare.net`) — [domain.glass svideo record](https://domain.glass/svideo.ltwebstatic.com); [nodedata shein.ltwebstatic.com](https://nodedata.io/shein.ltwebstatic.com)
- SHEIN's own H5 resource SDK whitelists image hosts `img.shein.com`, `img.romwe.com`, `img.ltwebstatic.com`, `file.ltwebstatic.com` — [SHEIN H5 resource SDK (verified)](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4)
- A direct HEAD request (2026-11-19, no Referer) to `https://img.ltwebstatic.com/v4/j/pi/2026/05/02/f8/17776852344d34295349aad8f43f4fbd32e5a672d8_thumbnail_405x552.jpg` returned `HTTP/1.1 200 OK`, `Content-Type: image/jpeg`, `Server: cloudflare`, `Cache-Control: public, max-age=691200`, `Access-Control-Allow-Origin: *` — [verified direct HEAD request](https://img.ltwebstatic.com/v4/j/pi/2026/05/02/f8/17776852344d34295349aad8f43f4fbd32e5a672d8_thumbnail_405x552.jpg)
- A captured media request to a SHEIN-related video served from `vipdiskon.oss-us-west-1.aliyuncs.com` showed `Server: AliyunOSS`, `Content-Type: video/mp4`, `Accept-Ranges: bytes`, `Content-Range`, and a request `Referer: https://www.shein.help/` — [urlscan result](https://api.urlscan.io/result/1fbbd424-e568-4ecc-a0f7-cfcdc856da3d)
- Third-party downloader documentation describes SHEIN pages as "dynamic SPA templates", "regional storefront redirects & bot challenges", and says it resolves "runway/try-on MP4 clips" from `ltwebstatic.com` — [TuGet SHEIN downloader docs](https://tuget.yueding168.com/en-US/platforms/shein/)

### Inferences

- Image URLs are usable directly in a browser app (public GET, CORS `*`), but the `_thumbnail_405x552`/WebP/AVIF suffixes are transform variants; SHEIN's own SDK rewrites those suffixes at runtime, so a stored thumbnail URL is a point-in-time asset, not necessarily the highest-quality master.
- Video URLs should be assumed potentially signed/expiring and region-bound: Aliyun OSS URLs commonly carry signature and expiry query parameters, and the observed CDN uses geo-DNS. Re-validate before playback; do not assume a harvested URL works weeks later or from another country.
- `Access-Control-Allow-Origin: *` on images does **not** prove the same for video hosts; CORS is irrelevant to plain `<video>` playback but relevant to canvas/fetch-based inspection.

### Gaps

- No direct HEAD/GET test was performed on a real `video.ltwebstatic.com` / `cvideo.ltwebstatic.com` product-video URL; hotlink protection, expiry parameter names and TTL are therefore **inferred**, not measured.
- No evidence found that quantifies how often a stored SHEIN video URL breaks (days vs weeks) or how strict geoblocking is by country.

## 3. Can a product video be played by a plain `<video src>` or iframe, or is a custom player required?

### Takeaway

The `video_link` reported by SHEIN scrapers is **not a playable media file**: a direct request returns a ~253 KB HTML page (a SHEIN H5 "Vimeo player" webapp). A plain `<video src="...video_link...">` will not work; playback requires resolving the underlying MP4 (or using SHEIN's JS player), and hotlink/embed behaviour on the media host is unverified.

### Cited Findings

- `curl -I` on `https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4` returned `HTTP/1.1 200 OK`, `Content-Type: text/html; charset=utf-8`, `Content-Length: 253219` — [verified direct HEAD request, 2026-11-19](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4)
- The body of that page contains `var videoUrl = querys['video_url'] || ''`, loads `//sheinh5.ltwebstatic.com/sh5_dist/libs/vimeo/player.min.js`, `<link ... vimeoPlayer-...css>`, and `detail_vimeo-player-...js`, plus `antiin` and `csrandom` risk SDKs and `var sheinDomains = ['shein', 'ltwebstatic']` — [verified page source](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4)
- Example scraper output gives `"video_link": "https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4"` and, elsewhere, the same link truncated at `...f17b` — [omkar.cloud tool docs](https://omkar.cloud/tools/shein-scraper/product-details); [Apify actor](https://apify.com/omkar-cloud/shein-product-scraper)
- An AliyunOSS-hosted SHEIN-adjacent MP4 response included `Accept-Ranges: bytes` and `Content-Type: video/mp4`, i.e. genuinely streamable media once the real media URL is known — [urlscan result](https://api.urlscan.io/result/1fbbd424-e568-4ecc-a0f7-cfcdc856da3d)
- A commercial SHEIN data API lists `video_url` as an available field but gives no public playback contract — [Crawlora SHEIN Product Detail API docs](https://crawlora.net/docs/shein/shein-products-detail)

### Inferences

- Store two distinct things in JSON: `video_player_url` (the `playVimeo` link) and `video_src` (a direct `.mp4`, **only if one is actually found in the saved HTML**). Do not silently treat the former as the latter.
- A plain `<video src>` is viable only for a direct `.mp4` on a permissive host; an iframe of `playVimeo` is a different proposition and may be blocked by frame-ancestors/X-Frame-Options or require SHEIN cookies/JS — not verified.
- If the saved HTML only contains a `playVimeo`-style hash/URL, the browser-only pipeline cannot turn it into playable media without either (a) executing SHEIN's player JS locally, or (b) resolving the media URL via a signed upstream call — both outside a simple "HTML → JSON" converter.
- Range support (`Accept-Ranges: bytes`) means direct MP4s can be seeked normally by a browser player if accessible.

### Gaps

- No test of `X-Frame-Options` / `Content-Security-Policy: frame-ancestors` on `api-shein.shein.com/h5/playVimeo`; iframe embeddability is unknown.
- No captured resolved MP4 URL behind a `playVimeo` link, so the exact media host, signature scheme and referer requirement for product videos remain unverified.
- No developer documentation found explaining `playVimeo`'s public contract; it appears to be an internal web endpoint.

## 4. What fields can reliably be extracted, with exact JSON paths / selector patterns?

### Takeaway

The most reliable identifiers and copy come from a product page's JSON-LD `Product` node (goods ID from the URL as fallback) and from the canonical link/`<title>`; image URLs come from DOM `img[src]` / `img[data-src]`. A direct video `.mp4` is the least reliable field and may be absent entirely.

### Cited Findings

- 2scraper reads product pages from schema.org JSON-LD and listing pages from `window.gbRawData`; its documented output columns are `sku`, `source`, `category`, `title`, `brand`, `price`, `currency`, `price_source`, `product_url`, `image_url`, `scraped_at`, `original_price`, `discount_pct`, `rating`, `review_count`, `store_code`, `in_stock`, `is_clearance`, `quickship` — [2scraper README](https://github.com/2scraper/shein-scraper)
- In that output, `sku` is defined as SHEIN's `goods_id` (stable across colours/sizes), `category` is SHEIN's category name, and `price_source` can be `embedded_json`, `json_ld` or `json_ld_min_variant` — [2scraper README](https://github.com/2scraper/shein-scraper)
- Crawlora's SHEIN detail response schema names these fields: `data.goods_id`, `data.goods_name`, `data.goods_sn`, `data.brand_code`, `data.category_id`, `data.category_name`, `data.description`, `data.images`, `data.video_url`, `data.store_code`, `data.sale_price`, `data.retail_price`, `data.usd_price`, `data.color_variants[]` (`goods_id`, `goods_sn`, `color_name`, `image`, `color_image`, `goods_url_name`), `data.sizes[]`, `data.skus[]` (`sku_code`, `stock`, prices) — [Crawlora docs](https://crawlora.net/docs/shein/shein-products-detail)
- Another documented SHEIN scraper output uses `goods_id`, `sku`, `name`, `link`, `category: {id, name, breadcrumb}`, `pricing`, `rating`, `reviews_count`, `images[]`, `has_video`, `video_link`, `colors[]`, `sizes[]` — [Apify actor example output](https://apify.com/omkar-cloud/shein-product-scraper)
- SHEIN product URL pattern is `...-p-<goods_id>.html` (e.g. `https://us.shein.com/product-p-515174062.html`); scrapers accept a numeric goods ID, a `goods_sn`/SKU, or a product URL from any country site — [Apify actor docs](https://apify.com/omkar-cloud/shein-product-scraper); [product URL used in this research](https://us.shein.com/product-p-515174062.html)
- Mobile BFF JSON paths documented for the same product: `info.productInfo.goods_name`, `info.productInfo.allColorDetailImages[goods_id]`, `info.productInfo.currentSkcImgInfo`, `info.productInfo.goods_img`, `info.productInfo.goods_thumb` — [airhick/shein_scrapper](https://raw.githubusercontent.com/airhick/shein_scrapper/main/HOW_IT_WORKS.md)
- SHEIN developer product APIs use `videoSourceUrl` as the name for a video link — [SHEIN Open Platform API doc detail/3002017](https://open.sheincorp.com/documents/apidoc/detail/3002017)

### Inferences

Recommended extraction order for a browser-side converter (all selectors/paths are **proposed**, based on the cited field names rather than a sampled saved file):

1. `goods_id` / SKU: regex the saved document's original URL or `<link rel="canonical">` for `-p-(\d+)\.html`; JSON-LD `Product.sku`/`Product.productID`/`@id` as secondary; `goods_sn` style SKUs (`sz...`) from JSON-LD `sku` if present.
2. Title: JSON-LD `script[type="application/ld+json"]` → node with `@type == "Product"` → `.name`; fallback `document.title` / `<h1>`.
3. Price / currency: JSON-LD `.offers.price`, `.offers.priceCurrency`, `.offers.lowPrice`; fallback DOM price element. Mark with `price_source: "json_ld" | "dom"`.
4. Brand / store: JSON-LD `.brand.name`, and store code from any embedded field named `store_code`.
5. Category: JSON-LD `.category` or breadcrumb DOM; listings may expose `category_name`.
6. Image thumbnail: first `<img>` in the gallery with `src`/`data-src` matching `img.ltwebstatic.com` or `img.shein.com`; normalise protocol-relative `//...` to `https://`.
7. Video: collect every absolute `.mp4` URL found in attributes or script text into `video_src[]`; separately collect any `api-shein.shein.com/h5/playVimeo?video_url=...` into `video_player_url`. Set `has_video` from either.
8. Canonical URL: `<link rel="canonical">`, else `https://us.shein.com/product-p-<goods_id>.html`.

A pragmatic record shape: `{source:"shein", goods_id, sku, title, brand, store_code, category, price, currency, image_url, video_src, video_player_url, has_video, product_url, extracted_at, strategy}`. Only the identity/title/image fields should be treated as "reliable"; video is opportunistic.

### Gaps

- Exact JSON-LD property names used by SHEIN in 2026 (e.g. whether `sku` holds goods ID or `goods_sn`, and whether a video field exists at all) were not verified against a real saved file.
- No verified CSS selectors for the gallery, price or video DOM nodes.
- It is unknown whether category/listing saved HTML contains any per-product structured data accessible after a plain Ctrl+S.

## 5. Does SHEIN offer a public API, seller API, affiliate API or product feed that is more reliable than saved HTML?

### Takeaway

There is no documented public read API for arbitrary SHEIN product videos. SHEIN's official Open Platform is a seller/logistics integration requiring an approved account and seller authorisation; affiliate programmes are publisher/link-tracking programmes, not a public product-media feed.

### Cited Findings

- SHEIN Open Platform is a merchant-integration platform exposing OpenAPI/Webhooks for product management, order fulfilment, logistics and stock-preparation fulfilment; production host `openapi.sheincorp.com`; requires an approved Open Platform account and seller authorisation — [SHEIN llms.txt / Open Platform overview](https://artifacts.apis.io/shein/llms/shein-llms.txt); [Open Platform EN](https://open.sheincorp.com/en)
- Onboarding is "Open Platform Account Application → Create Application → Application Review → Authorization Integration (seller authorizes the application) → Solution Integration" — [SHEIN llms.txt](https://artifacts.apis.io/shein/llms/shein-llms.txt)
- Developer docs include product-list APIs such as `/open-api/openapi-business-backend/product/query` (returns only approved products) and product attribute/feed endpoints including `POST https://openapi.sheincorp.com/open-api/sem/feed/createFeed` — [SHEIN API doc 3000266](https://open.sheincorp.com/documents/apidoc/detail/3000266-1000001); [SHEIN API doc 3001230](https://open.sheincorp.com/documents/apidoc/detail/3001230)
- A scraper project's FAQ answers "Does SHEIN have a public API?" with "This repository does not use one. It reads what us.shein.com's own pages carry" — [2scraper README](https://github.com/2scraper/shein-scraper)
- SHEIN runs affiliate publisher programmes via networks including Awin (reported 10% commission, 30-day cookie), Skimlinks (150+ countries, 600,000+ products) and Takeads; these provide tracking links/API for publishers — [Awin](https://awin.com/us/news-and-events/program-news/shein-affiliate-program-now-live-on-awin); [Skimlinks](https://skimlinks.com/shein-affiliate-program); [Takeads](https://takeads.com/merchants/shein)
- Paid third-party APIs expose `video_url`/`video_link` as a field (Crawlora, Apify, realdataapi, XCrawl) but are paid scraping services, not SHEIN-official APIs — [Crawlora](https://crawlora.net/docs/shein/shein-products-detail); [realdataapi](https://www.realdataapi.com/shein-api.php); [XCrawl](https://www.xcrawl.com/solutions/shein-product-scraper-api/)

### Inferences

- For this project's constraint (no server-side scraping, only JSON uploaded to Supabase), an official SHEIN API is not a practical substitute: seller authorisation is required and the documented APIs are for managing one's own catalog, not reading arbitrary products' videos.
- Affiliate networks may offer product feeds to approved publishers, but nothing found in this research says those feeds include product video URLs; treat that as unverified.
- The realistic options remain: (a) parse what the user's saved HTML contains, or (b) accept that video records will be sparse and mostly image-only.

### Gaps

- Did not inspect affiliate network feed documentation for a video/media field.
- Did not enumerate all Open Platform product-read endpoints; a seller-authorised endpoint that returns `videoSourceUrl` for one's own products exists ([doc 3002017](https://open.sheincorp.com/documents/apidoc/detail/3002017)) but is irrelevant to arbitrary third-party products.

## 6. robots.txt rules and ToS stance on scraping / rehosting product media

### Takeaway

SHEIN's US robots.txt does **not** disallow product or category pages, but it does disallow account/cart/risk/campaign paths. SHEIN's terms assert copyright ownership over site content including videos and restrict use of that content; there is no found licence permitting rehosting product media on another domain.

### Cited Findings

- `https://us.shein.com/robots.txt` (fetched 2026-11-19) contains `User-agent: *`, `Disallow: /user/`, `Allow: /user/auth/login`, `Disallow: /cart/`, `Disallow: /atomic/`, `Disallow: /geetest/`, disallows several API/campaign paths (`/abt/userinfo`, `/coupon/getCouponListForOrder`, `/datasecurity`, `/*?ref=us&rep=dir&ret=mus*`, `/campaign/*test*` etc.), and `Sitemap: https://us.shein.com/sitemap-index.xml`. Product (`-p-.html`) and category (`-c-.html`) paths are **not** listed as disallowed — [SHEIN US robots.txt (verified)](https://us.shein.com/robots.txt)
- SHEIN's Terms & Conditions §6 "INTELLECTUAL PROPERTY AND OWNERSHIP" states that the Services' content includes "text, software, scripts, graphics, photos, sounds, music, videos" and is the property of SHEIN or others — [SHEIN T&C (CA mirror)](https://ca.shein.com/Terms-and-Conditions-a-399.html); [SHEIN T&C (TW mirror)](https://m.shein.tw/Terms-and-Conditions-a-399.html)
- Another regional terms page says content "shall at all times [be] the property of the Company or to those who grant us the license for their use and is protected by U.S. and international copyright laws. You may use the Content only to the extent that we or the usage..." — [SHEIN U.S. Terms & Conditions](https://m.shein.com/us/TERMS-CONDITIONS-a-1060.html)
- A regional terms snippet prohibits users who "transmit, create derivative works from, translate, modify, reverse-engineer, disassemble, decompile or otherwise exploit the Services or any portion of them unless expressly permitted by the Company" — [SHEIN Terms (MA mirror)](https://ma.shein.com/Terms-and-Conditions-a-399.html)
- An open-source scraper's FAQ cautions: scraping public pages is permitted in many jurisdictions, but SHEIN's terms, copyright in product texts/images, and data-protection law differ by country; it advises low request rates and no personal-data collection — [2scraper README](https://github.com/2scraper/shein-scraper)

### Inferences

- robots.txt alone does not prohibit the user's own browsing/saving of product pages; the stricter constraint is copyright/ToS. Storing a URL string in JSON is materially different from copying and rehosting the MP4; a web app that hotlinks or downloads SHEIN media may raise ToS/copyright issues that the user should review.
- The tool can reduce risk by storing metadata and source URLs only, and by not rehosting SHEIN media on Supabase storage.

### Gaps

- Full ToS article text could not be retrieved (the article body is JS-rendered; direct fetch of the US terms page returned navigation only), so no single canonical clause specifically about scraping or media rehosting can be quoted with confidence.
- No SHEIN-issued API licence or Media Usage Guidelines document was found that explicitly allows or denies rehosting product videos.

## 7. Anti-bot protection and whether saved HTML contains media URLs or gets them injected later by JS

### Takeaway

SHEIN actively gates automated clients with its own `/risk/challenge` and `/risk/action/limit` endpoints and multiple JS SDKs; the served HTML is a shell with media URLs injected later by JS. A real user's browser session normally passes this, so Ctrl+S can still capture the rendered DOM — but only what JS has actually written into it.

### Cited Findings

- SHEIN sends suspicious visitors to `/risk/challenge` (I-am-human checkbox, 3×3 image grid, icon-order puzzle) or `/risk/action/limit` (rate limit); measured 2026-09-30: 3 of 5 fresh US Scraping Browser profiles passed the challenge, each on its third round; a Hetzner datacentre address was rate-limited on 2026-11-18 — [2scraper README](https://github.com/2scraper/shein-scraper)
- The same project reports that local browsers without proxies/keys are frequently sent to the risk gateway and that a Scraping Browser profile which has passed the challenge keeps its cookies — [2scraper README](https://github.com/2scraper/shein-scraper)
- Another scraper documents that SHEIN may serve a risk page even for a mobile product shell (`.../risk/challenge?captcha_type=909...`), and that the signed BFF request needs `Anti-In`, `x-gw-auth`, `x-cs-random`, `x-oest`, `webVersion`, `x-ad-flag`, `x-csrf-token`, `timezone`, `armorToken` headers generated by `antiin`, `signature`, `csrandom` JS SDKs — [airhick/shein_scrapper](https://raw.githubusercontent.com/airhick/shein_scrapper/main/HOW_IT_WORKS.md)
- A browser-automation scraper describes SHEIN as requiring JavaScript rendering and authenticated sessions, and says it auto-scrolls to trigger lazy-loaded content and saves a localised page snapshot with `video_1.mp4` when present — [BrenoFariasdaSilva/E-Commerces-WebScraper](https://github.com/BrenoFariasdaSilva/E-Commerces-WebScraper)
- The direct fetch for this research returned the shell with `antiin`, `csrandom`, `risk_streamline` scripts and no product data, confirming that HTML delivered without a normal browser session is not the product DOM — [product page fetch, verified](https://us.shein.com/product-p-515174062.html)
- The `playVimeo` player page likewise loads `antiin`/`csrandom` and defines `videoUrl` from the query string in JS, i.e. the media source is resolved at runtime — [verified page source](https://api-shein.shein.com/h5/playVimeo?video_url=1784619589d09dca1cb9b574e1cd673594f17bda42.mp4)
- Community writeups describe 2025-era anti-bot escalation for TEMU and SHEIN (fingerprint-based DOM variation, bot-challenge handling) — treat as lower-quality corroboration — [ScraperScoop blog](https://www.scraperscoop.com/blog/how-to-scrape-temu-shein-in-2025-prices-change-every-11-minutes/)

### Inferences

- Practical user instruction: log in / clear challenges in the normal browser first, open the product page, scroll through the gallery (and any video thumbnail) so lazy content is materialised, then Ctrl+S → "Webpage, HTML Only". If the user is served a challenge page, the saved HTML will be useless and should be rejected by the importer.
- The importer should detect failure explicitly: if the saved HTML lacks JSON-LD, CDN image URLs and a goods ID, report "no product data captured" rather than emitting an empty JSON record.
- Because media URLs are injected by JS, there is a real chance the saved HTML contains only a poster image and a video identifier, not an `.mp4`. The JSON schema should allow `video_src: null` with `video_player_url` retained as a lead.

### Gaps

- No quantitative measurement of how often a normally-browsed, scrolled SHEIN PDP's saved HTML contains a direct `.mp4`.
- No test of whether saving with "Webpage, Complete" (which creates a `_files` folder with downloaded media) would capture the actual video file; not in scope of the stated "HTML only" workflow.
