# ASOS as a source of product videos for a saved-HTML → JSON import pipeline (as of 19 Nov 2026)

Research constraint encountered up front: **I could not obtain the raw, post-`Ctrl+S` HTML of any ASOS product page.** Direct fetches to `www.asos.com` from the research environment timed out or failed at the transport layer on every attempt (webfetch, PowerShell `curl.exe`, three public proxies). I could only retrieve (a) robots.txt and sitemaps and (b) Jina Reader's *rendered Markdown* view of product pages, which strips `<script>`/image URLs. Therefore everything below is explicitly marked **VERIFIED** (directly observed / directly cited) or **INFERRED** (reasonable engineering conclusion that must be checked against a real saved file). No code-relevant JSON path or CDN URL is presented as verified unless I actually observed it.

---

## Q1. What does a saved ASOS product page HTML contain (JSON-LD, `__NEXT_DATA__`, Apollo/Redux, `<video>`, direct `.mp4`)?

### Takeaway
**Unresolved — this is the single largest gap.** ASOS product pages are JS-rendered and bot-protected; I could not inspect the raw saved HTML. The rendered view I did obtain shows only global navigation/footer content, which suggests the interesting product payload is inserted by JavaScript and/or lives in a hydration blob that a "Webpage, HTML only" save may or may not preserve.

### Cited Findings
- VERIFIED: Current (2026) canonical ASOS PDP URL form is `https://www.asos.com/<brand>/<slug>/prd/<productid>`, e.g. `https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221`; the live product sitemap `product-sitemap-com-x.xml` is composed of exactly these `<loc>` values. [Source](https://r.jina.ai/https://www.asos.com/product-sitemap-com-x.xml)
- VERIFIED: An older `/prp?productid=116024881` URL redirected to the ASOS homepage when fetched (the product is likely delisted, so this does **not** by itself prove the old route is retired). robots.txt explicitly disallows the legacy `*/Prod/*` PDP pattern, showing a past PDP URL scheme. [Source](https://r.jina.ai/https://www.asos.com/robots.txt)
- VERIFIED: Jina Reader's view of a live PDP returns the page title (`XLARGE skull in flames t-shirt in black | ASOS`) plus ~1,200 lines of global header/navigation/footer, but **no product price, colour, image URLs, or video URLs**. The fetched document includes a OneTrust cookie-consent dialog (`cdn.cookielaw.org` assets) and a "your browser is not supported" banner. [Source](https://r.jina.ai/https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221)
- VERIFIED: Third-party scraper vendors describe ASOS as having no public API and needing browser/JS rendering for detail extraction, e.g. the Apify actor README states "Since Asos doesn't provide an API, this actor should help you to retrieve data from it", and DataHut describes using Playwright plus requests/BeautifulSoup for ASOS detail pages. [Source](https://github.com/epctex-support/asos-scraper); [Source](https://www.blog.datahut.co/post/scraping-the-style-unveiling-asos-trends-with-web-scraping)
- VERIFIED (general technique, not ASOS-specific): JSON-LD extraction pattern is `document.querySelectorAll('script[type="application/ld+json"]')`; Next.js hydration pattern is `document.getElementById('__NEXT_DATA__')` and `JSON.parse(...)`; selectors and scripts can also be injected by JS after load. [Source](https://webscraper.io/blog/extract-json-ld-structured-data); [Source](https://www.scraping.club/p/scrape-nextjs-websites)
- NO SOURCE FOUND: I found no 2024–2026 writeup that names an ASOS-specific JSON-LD `Product.video` block, an ASOS `__NEXT_DATA__` path, an Apollo/Redux state key, an ASOS `<video>` tag, or a direct ASOS `.mp4` URL. Searches for these terms returned generic JSON-LD/Next.js documentation and scraper-vendor marketing pages only.

### Inferences
- A practical browser-side importer should treat *all* of these as **opportunistic probes**, not guaranteed sources: `script[type="application/ld+json"]` blocks (walk for `@type: Product` / `VideoObject`, `video.contentUrl`, `video.thumbnailUrl`, `sku`, `productID`, `offers.price`), `<script id="__NEXT_DATA__">`, scripts whose text matches `window.__INITIAL_STATE__|window.__APOLLO_STATE__|__PRELOADED_STATE__|self.__next_f`, `<video>`/`<source src>` elements, and a regex over any inline script text for `https?://[^"'\\ ]+\.mp4(?:\?[^"'\\ ]*)?` and for `\.m3u8`.
- "Webpage, HTML only" (Ctrl+S) saves the DOM **as received**, not the post-hydration DOM. If ASOS injects product media client-side, the saved file may contain only a shell; users may need "Webpage, Complete" (which also writes resource folders) or a browser extension that serialises `document.documentElement.outerHTML` **after** scrolling. This is a browser-mechanics inference, not an ASOS-verified fact.
- Because the ASOS Live shoppable-video experience is app-only and Bambuser-powered (see Q3), the presence of a video on a *product* page — and its representation in HTML — may vary by product, region and experiment. Treat video as optional metadata.

### Gaps
- Exact contents of a real saved ASOS PDP HTML: no raw file was obtainable. Needs a one-off manual save from a real logged-in browser and a `grep` for `ld+json`, `__NEXT_DATA__`, `.mp4`, `m3u8`, `videoUrl`, `media`, `bambuser`.
- Whether any ASOS PDP emits schema.org `Product.video` / `VideoObject` at all.
- Whether a saved category/listing page contains video data or only product tiles (listing pages are even less likely to include per-product video records).

---

## Q2. Which CDN/domains host ASOS product videos and images; are URLs stable/tokenised/geoblocked/expiring?

### Takeaway
**Not verified.** No direct media URL was observable in any HTML I could retrieve. The only media-adjacent domains I actually saw were OneTrust/ASOS static asset domains. ASOS's newer "shoppable video" stack is Bambuser, whose player is SDK/show-ID based rather than a published stable `.mp4` pattern.

### Cited Findings
- VERIFIED domains observed in fetched ASOS HTML: `cdn.cookielaw.org` (OneTrust consent dialog assets) and `assets.asosservices.com/storesa/images/flags/gb.png` (country flag). [Source](https://r.jina.ai/https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221)
- VERIFIED: ASOS introduced "ASOS Live" on 2 Oct 2025, an in-app video shopping experience with 94% of views on replay; it is described as available **only in the ASOS app, not browser**. [Source](https://www.asosplc.com/news-and-media/latest-news/asos-live-a-new-era-of-video-shopping); [Source](https://www.internetmatters.org/advice/apps-and-platforms/online-shopping/asos-live)
- VERIFIED: ASOS's shoppable-video content surfaced in ChatGPT is powered by **Bambuser**, using its Intelligence Layer and video player widget to turn ASOS's product catalogue and video library into machine-readable shoppable video. [Source](https://internetretailing.net/asos-brings-shoppable-video-content-to-chatgpt-in-uk-first)
- VERIFIED: Bambuser documents an embeddable JS player with a Player API (`window.initBambuserLiveShopping({showId: 'YOUR_SHOW_ID', ...})`), configuration via `videoId` / show IDs, and deeplinks that "will become invalid if the video content for a specific show is changed" — i.e. identifiers/deeplinks are dynamic, not a stable file URL. [Source](https://bambuser.com/docs/live/player-api-reference); [Source](https://github.com/bambuser/bambuser-commerce-sdk-ios)
- VERIFIED (general, not ASOS): CDN video URLs are frequently tokenised/expiring; video SEO guidance explicitly warns that CDN `contentUrl` links can carry expiry tokens in path or query, which is why `embedUrl` is preferred for rich results. [Source](https://www.vidbeo.com/blog/json-ld-for-video-seo)
- NO SOURCE FOUND: no primary or credible secondary source in this research confirmed `images.asos-media.com`, `media.asos.com`, or any ASOS `*.mp4` URL pattern. Jina's Markdown output replaced image sources with `blob:http://localhost/...` placeholders, so image hosts could not be observed.

### Inferences
- Do **not** design the importer around a guessed hard-coded ASOS mp4 URL template. Extract whatever URL the saved HTML actually contains and store it as opaque data with a `source_url` provenance field.
- If a saved page contains a Bambuser `showId`/`videoId`, playback almost certainly requires the Bambuser JS player (or an API-resolved asset URL), not a plain `<video>`.
- Expect possible hotlink/CORS/referrer restrictions and regional variation; a URL that plays in a browser on asos.com may fail from the user's own web app. Test playback at import time and record a `playable` boolean rather than assuming.

### Gaps
- Exact ASOS image/video hostnames, URL shapes, token parameters, expiry behaviour and geoblocking.
- Whether older ASOS product videos are plain MP4 on an ASOS-owned CDN while newer shoppable videos are Bambuser-hosted.
- Whether extracted URLs permit direct `<video>` playback cross-origin (CORS not needed for plain `<video>`, but hotlink protection/referrer checks may still apply).

---

## Q3. Can a product video be played with plain `<video src>` or an iframe, or is a player SDK needed? Is there an embed URL form?

### Takeaway
**No ASOS product-video embed URL was verified.** The one verified ASOS video stack (Bambuser shoppable video) uses a JavaScript player initialised by IDs, so a plain `<video src>` is unlikely to work for that content; an iframe form was not found.

### Cited Findings
- VERIFIED: Bambuser's shoppable video is integrated into product pages via an **embed code / player**, not a documented public iframe URL; Bambuser describes an "embeddable JavaScript player that loads asynchronously" and product pages using an embed code. [Source](https://bambuser.com/shoppable-video); [Source](https://bambuser.com/article/what-is-shoppable-video)
- VERIFIED: Bambuser Web Player API configuration uses `showId` / `videoId` style identifiers and events, and deeplinks can be set via `player.configure({deeplink: "f00ba5@100"})` or `window.initBambuserLiveShopping({showId: 'YOUR_SHOW_ID', ...})`. [Source](https://bambuser.com/docs/live/player-api-reference)
- VERIFIED: ASOS Live is app-only, so its videos have no browser embed surface at all. [Source](https://www.internetmatters.org/advice/apps-and-platforms/online-shopping/asos-live)
- VERIFIED: Generic HTML5 `<video src="...">` plays a public direct MP4 file; multiple `<source>` elements allow codec fallback, and `poster` supplies a thumbnail. [Source](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video)
- VERIFIED: Schema.org `VideoObject.contentUrl` is defined as the URL of the actual video bytes, while `embedUrl` points to a player page; both are used in JSON-LD. [Source](https://schema.org/VideoObject); [Source](https://developers.google.com/search/docs/appearance/structured-data/video)
- NO SOURCE FOUND: any ASOS-specific iframe embed URL, oEmbed endpoint, or publicly documented player SDK for ASOS product video.

### Inferences
- Implementation recommendation: store both `video_url` (whatever direct media URL was found) and `embed_url`/`player_id` (if a Bambuser/other ID was found). In the web app, try `<video src={video_url}>` first and fall back to a link-out ("View on ASOS") when playback fails; do not bundle a third-party player SDK without confirming the exact provider from a real saved page.
- If the importer finds only an `embedUrl` from JSON-LD, an iframe is the right playback primitive, but the host must allow framing (X-Frame-Options/CSP) — untested.

### Gaps
- Real-world playback test of an ASOS product video URL from a third-party origin.
- Whether any ASOS embed URL exists and permits cross-site iframe embedding.

---

## Q4. Which fields can reliably be extracted, with exact attribute names / JSON paths / selectors?

### Takeaway
Only **product ID and canonical URL** are verified from a primary source (ASOS XML sitemaps). Everything else is either present in the rendered page text (title) or reported by third-party scraper vendors; no ASOS-specific JSON path or CSS selector was verified.

### Cited Findings
- VERIFIED — product ID / canonical URL: `<loc>https://www.asos.com/<brand>/<slug>/prd/<digits></loc>` in ASOS's product sitemaps. Regex that will work on a saved page's canonical link or URL: `/\/prd\/(\d{6,})/`; legacy form `productid=(\d+)`. [Source](https://r.jina.ai/https://www.asos.com/product-sitemap-com-x.xml)
- VERIFIED — title text: the live PDP's `<title>` is `XLARGE skull in flames t-shirt in black | ASOS`, i.e. `document.title.replace(/\s*\|\s*ASOS\s*$/, '')` yields a usable product title for that page. [Source](https://r.jina.ai/https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221)
- VERIFIED — category/brand hints in URL: the URL slug contains brand (`xlarge`) and descriptive words; site category URLs use `/cat/?cid=<digits>`, e.g. `/women/dresses/cat/?cid=8799`. [Source](https://r.jina.ai/https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221)
- VERIFIED (third-party selector evidence): a published ASOS scraper snippet uses `[data-auto-id='productTilePrice'] span` for listing-card prices and `a.href` for the product link. [Source](https://spider.cloud/scrapers/asos-scraper)
- VERIFIED (third-party field list): a prebuilt ASOS listing scraper advertises extraction of product name, brand, sku, price, original price, discount, currency, availability, rating, review count, description, main image, images, colour, product URL — **no video field**. [Source](https://webscraper.io/marketplace/asos-products-listings-scraper)
- VERIFIED: a commercial ASOS product API reports a response shape with `id`, `name`, `price`, `sizes`, `details`, `imageUrl`, `reviews` — again with no video field. [Source](https://www.retailed.io/datasources/api/asos-product)
- VERIFIED (general patterns to try, not ASOS-confirmed): JSON-LD Product fields `name`, `sku`, `productID`, `brand`, `offers.price`, `offers.priceCurrency`, `image`, `video`, `category`; Next.js data in `<script id="__NEXT_DATA__">`. [Source](https://webscraper.io/blog/extract-json-ld-structured-data); [Source](https://www.scraping.club/p/scrape-nextjs-websites)

### Inferences
- Suggested robust extraction cascade for the browser-side converter (all keys optional):
  1. `canonical` = `document.querySelector('link[rel=canonical]')?.href` → fallback `location.href` of saved page → regex `/prd\/(\d+)/`.
  2. `title` = JSON-LD Product `name` → `document.title.replace(/ \| ASOS$/,'')` → `<h1>` text.
  3. `brand` = JSON-LD `brand.name` → first path segment heuristic from URL.
  4. `price`/`currency` = JSON-LD `offers.price` / `offers.priceCurrency` → `[data-auto-id='productTilePrice']` text on listing pages.
  5. `colour`, `category`, `thumbnail` = JSON-LD `color`, `category`, `image` → `<meta property="og:image">` → first large `images.asos-media.com`-like URL found (hostname must be whitelisted at runtime, not assumed).
  6. `video_url` / `embed_url` / `thumbnail_url` = walk every JSON-LD `video` / `VideoObject` (`contentUrl`, `embedUrl`, `thumbnailUrl`), then `<video src>`, `<source src>`, then regex over all inline script text for `.mp4`/`.m3u8`/known player IDs.
- Category/listing saves should produce many records: iterate product tile anchors matching `a[href*="/prd/"]` and extract an ID/title from each tile; expect no per-tile video data.

### Gaps
- Any verified ASOS-specific JSON path for price, brand, colour, image or video.
- Confirmation that `<meta property="og:image">`, JSON-LD, or `data-auto-id` attributes survive in a "Webpage, HTML only" save.
- Exact DOM structure of a 2026 PDP gallery/player.

---

## Q5. Public product API, affiliate API or product feed more reliable than saved HTML?

### Takeaway
There is **no ASOS public product API found**, but affiliate networks (Awin in particular) expose product feeds to approved publishers, and several paid third-party scraper APIs exist. None of these were verified to include **video** URLs.

### Cited Findings
- VERIFIED (vendor claim): "Since Asos doesn't provide an API, this actor should help you to retrieve data from it" — Apify ASOS scraper README. [Source](https://github.com/epctex-support/asos-scraper)
- VERIFIED: Awin's own FAQ says the Awin API gives publishers direct access to account data including **product feeds**, and feeds can be created as Excel/CSV/XML in "My Product Feeds". [Source](https://www.awin.com/us/faqs)
- VERIFIED: Awin product feeds are submitted as delimited text or XML; publishers can view/download them via the UI or the ProductServe API. [Source](https://www.datafeedwatch.com/blog/the-guide-to-increasing-sales-with-awin)
- VERIFIED: Awin API returns JSON (feeds excepted), has per-minute quotas (~20 requests/minute in one comparison), and uses separate endpoints per service. [Source](https://help.awin.com/docs/comparison-between-shareasale-and-awin-apis)
- VERIFIED (secondary): ASOS runs several region-specific affiliate programmes through different networks (Awin, FlexOffers, Rakuten Advertising per aggregator reports); rates are network-specific and not confirmed by ASOS itself. [Source](https://www.makeinfluence.com/en/academy/asos-affiliate-program-how-it-works-for-fashion-creators-and-publishers)
- VERIFIED: Paid third-party ASOS data APIs exist (Axesso, Retailed, Bright Data, Outscraper, Spider). [Source](https://axesso.de/asos-api); [Source](https://www.retailed.io/datasources/api/asos-product); [Source](https://brightdata.com/solutions/data-extraction/asos); [Source](https://outscraper.com/asos-scraper); [Source](https://spider.cloud/scrapers/asos-scraper)
- VERIFIED (secondary, 2026): ASOS's ChatGPT shoppable-video integration uses Bambuser's "Intelligence Layer" to make its video library machine-readable — evidence that a structured video feed exists internally, but it is not a public developer API. [Source](https://internetretailing.net/asos-brings-shoppable-video-content-to-chatgpt-in-uk-first)

### Inferences
- For a browser-only saved-HTML tool, affiliate feeds are not an automatic replacement: they need publisher approval and are typically advertiser-supplied catalogue data (image URLs, deeplinks), with no evidence of product-video fields. Third-party APIs would also break the "no server-side scraping, JSON only to Supabase" design if they require a secret key in the client.
- Best fit remains the local HTML → JSON converter, with acceptance criteria lowered to "metadata + whatever media URL is present".

### Gaps
- Whether any Awin ASOS programme feed actually contains a video field, and which ASOS regional programme covers the user's market.
- Whether Bambuser exposes an authenticated catalog API that ASOS partners can query (no public endpoint verified).

---

## Q6. robots.txt rules and ToS stance on scraping / rehosting product videos

### Takeaway
ASOS robots.txt (retrieved 19 Nov 2026 via text proxy) does **not** disallow product (`/prd/`) or category pages for `User-agent: *`, but it does disallow several legacy/utility paths. Separately, ASOS's website Terms explicitly prohibit automated data extraction ("screen scraping"), and ASOSIP/careers terms prohibit copying materials without written permission.

### Cited Findings
- VERIFIED — robots.txt `User-agent: *` rules: `Disallow: */web/pages/*`, `*/shared-board/*`, `*/security-issues*`, `*/report-a-legal-concern*`, `*/discover/no-results-page/*`, `*/Prod/*` (legacy PDP), `*scrollTo=`, `*scrollto=`. `User-agent: AdsBot-Google` disallows `/api/commerce/bag/*/total`; Twitterbot/Snapbot are allowed shared boards. Sitemaps include `product-sitemap-index-COM.xml` and per-country product sitemaps. [Source](https://r.jina.ai/https://www.asos.com/robots.txt) (original: https://www.asos.com/robots.txt)
- VERIFIED — ToS: ASOS US Terms & Conditions state "you're not allowed to use automated systems or software to extract data from our Website (AKA 'screen scraping')". [Source](https://www.asos.com/us/terms-and-conditions)
- VERIFIED — ASOS careers site terms: "All materials, content and forms contained on this website are the intellectual property of ASOS and may not be copied, reproduced, distributed or displayed without ASOS's express written permission", with an exception for printing complete pages as hard copies for personal use. [Source](https://www.asoscareers.com/site/terms-use)
- VERIFIED — a scraper vendor's own assessment: "ASOS's terms of service restrict automated commercial access; how that applies to your case is a question for your legal counsel." [Source](https://groupbwt.com/industry/retail/asos)
- VERIFIED — robots.txt is a crawler-traffic convention, not law and not a general permission signal; disallowed pages can still be indexed, and other crawlers interpret it differently. [Source](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- VERIFIED — ASOS legal text includes DMCA agent provisions and IP-respect language on its site. [Source](https://www.asos.com/us/terms-and-conditions)

### Inferences
- A user manually saving a page they are browsing is not "automated scraping" in the literal ToS wording; the risky part would be **automating** collection at scale or **rehosting** ASOS-owned video files in the user's web app. This is a legal-risk inference, not legal advice.
- Safer product behaviour: store only metadata + source URLs, link back to ASOS with attribution, and let playback happen via the original URL rather than copying media into your own storage. Flag rehosting as requiring permission.

### Gaps
- Full text of ASOS's current UK/global T&C clause specifically covering product images/video reuse (the Jina fetch of `/terms-and-conditions/` returned only navigation, so I relied on a search-engine excerpt of the US page).
- Any explicit ASOS statement about product-video licensing or hotlinking.

---

## Q7. Anti-bot protection affecting saving, and does it affect saved HTML content?

### Takeaway
Strong access controls are **empirically confirmed**: every datacenter-style request to asos.com failed, while a text-only proxy that renders pages succeeded. The specific vendor (Akamai/Cloudflare/etc.) is **not verified**. Anti-bot affects *access*, not necessarily the contents of a page a real user has already saved.

### Cited Findings
- VERIFIED (observed in this research): `webfetch https://www.asos.com/robots.txt` → "Request timed out" then "Transport error (GET https://www.asos.com/robots.txt)". The same URL via `https://r.jina.ai/https://www.asos.com/robots.txt` returned the full file. [Source](https://r.jina.ai/https://www.asos.com/robots.txt)
- VERIFIED (observed): PowerShell `curl.exe -sSL --max-time 40 -A "Mozilla/5.0 ..."` to `https://www.asos.com/robots.txt` returned `curl: (28) Operation timed out after 40001 milliseconds with 0 bytes received`.
- VERIFIED (observed): public proxies failed — `api.allorigins.win/raw?...` → HTTP 408, `api.codetabs.com/v1/proxy?quest=...` → HTTP 522, `www-asos-com.translate.goog/...` → HTTP 408 — while `r.jina.ai` succeeded for the same destination. [Source](https://r.jina.ai/https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221)
- VERIFIED: the delivered page includes a OneTrust consent platform dialog and a "your browser is not supported" notice, i.e. client-side gating layers exist in the HTML. [Source](https://r.jina.ai/https://www.asos.com/xlarge/xlarge-skull-in-flames-t-shirt-in-black/prd/210636221)
- VERIFIED: scraper vendors market "real-time", "browser", "proxy rotation" extraction for ASOS, consistent with non-trivial bot defences and JS-heavy pages. [Source](https://brightdata.com/solutions/data-extraction/asos); [Source](https://www.blog.datahut.co/post/scraping-the-style-unveiling-asos-trends-with-web-scraping)
- NO SOURCE FOUND: identification of the actual WAF/CDN vendor or any published ASOS statement about bot blocking.

### Inferences
- The failures are consistent with IP/ASN reputation blocking, TLS/HTTP-fingerprint checks, or proxy-side timeouts rather than a simple `robots.txt` disallow. Do not build any server-side fallback that tries to fetch asos.com — it will fail and it is out of scope for this tool.
- A real user's browser session (cookies, consent accepted, JS executed) is exactly the case where saving works; anti-bot does **not** corrupt the already-saved DOM. It only determines whether the media request that fills the `<video>` element succeeded before the save.
- Because media may be lazy-loaded, instruct users to scroll through the gallery and press play once before Ctrl+S; otherwise the saved HTML may contain an empty player shell even if the site would normally expose a video URL.

### Gaps
- Which anti-bot product ASOS uses and whether it injects/challenges the product payload in the initial HTML.
- Whether the saved HTML from a consented session contains the data blobs needed, or whether the importer must ask users to save via a browser extension that serialises the live DOM.

---

## Consolidated, code-relevant checklist for the report writer

**Verified facts safe to state:** ASOS PDP IDs are `/prd/<digits>` and appear in `product-sitemap-index-COM.xml` children; robots.txt does not disallow `/prd/` or `/cat/` for `*` but does disallow `*/Prod/*` and various utility paths; ASOS ToS prohibit screen scraping; ASOS Live is app-only and Bambuser-powered; no public ASOS product API was found; Awin provides publisher product feeds; direct datacenter fetches to asos.com fail.

**Must be labelled as unverified/inferred:** all claims about JSON-LD `__NEXT_DATA__` structure, image/video CDN hostnames, MP4/iframe playability, token expiry, geoblocking, and every CSS selector except `[data-auto-id='productTilePrice'] span` (which comes from a third-party scraper, not from ASOS).

**Recommended importer design given the evidence:** opportunistic multi-source extractor (JSON-LD → `__NEXT_DATA__`/inline-script regex → DOM selectors → `<video>`/`<source>`), output `{id, title, brand, price, currency, colour, category, thumbnail_url, canonical_url, video_url, embed_url, player_id, source: "asos", source_file, extracted_at}`, with `video_url` nullable and a "link out to ASOS" fallback; no assumptions about a fixed ASOS CDN template; no rehosting of media.
