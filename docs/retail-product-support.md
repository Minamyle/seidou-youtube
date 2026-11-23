# Adding ASOS, Temu and SHEIN product pictures

The import tool accepts product pages from ASOS, Temu and SHEIN alongside
YouTube and X videos. Shop records are **picture posts**, not videos: each one
is a product's main picture, shown in the feed and linked to the product page.

A shop record has:

- `videoUrl` - the **product page** link. It identifies the product (by its
  product ID) and is where the post links to. The field keeps the `videoUrl`
  name so every platform uses the same JSON shape.
- `imageUrl` - the **product picture**. Required for shop records, and not
  allowed on YouTube or X records.

| Shop | Product page link | Picture usually from |
| --- | --- | --- |
| ASOS | `.../prd/<id>` | `images.asos-media.com` |
| Temu | `goods.html?goods_id=<id>` or `...-g-<id>.html` | `img.kwcdn.com` |
| SHEIN | `...-p-<id>.html` | `img.ltwebstatic.com` |

## 1. Apply the database migrations

Run these once, in order, in the Supabase SQL editor (or with the Supabase
CLI), after the X migration:

1. `supabase/migrations/20261119120000_add_retail_product_support.sql`
2. `supabase/migrations/20261123120000_move_retail_products_to_own_table.sql`

Shop products live in their **own table, `catalogue_products`**, not in
`catalogue_videos`. That matters because the main app mirrors
`catalogue_videos` into Seidou Social's `videos` table; products must not show
up there. The second migration:

- creates `catalogue_products` (anyone can read it, only the import service
  can write to it)
- moves any shop rows already in `catalogue_videos` into it, fixing early
  120px ASOS pictures and removing prices from titles
- removes those rows from Seidou Social, along with the empty placeholder
  channels made for them
- returns `catalogue_videos` to YouTube and X only
- replaces `import_video_batch`: YouTube/X rows go to `catalogue_videos`, shop
  rows go to `catalogue_products`, in one transaction

Sanity is not touched.

## 2. JSON format

```json
{
  "category": "Skirts",
  "channelName": "Shein",
  "videoUrl": "https://us.shein.com/High-Waist-Pencil-Skirt-p-515174062.html",
  "videoTitle": "High Waist Pencil Skirt",
  "platform": "shein",
  "imageUrl": "https://img.ltwebstatic.com/images3/skirt.jpg"
}
```

`channelName` comes from the filename (as for YouTube and X), otherwise the
brand on the page, otherwise the shop name.

## 3. Convert a saved HTML page to JSON

Both product pages and search/category pages work:

- **Product page** gives one record. The picture comes from the page's product
  data, then its share image, then the first product photo.
- **Search or category page** gives one record per product card, with that
  card's picture. Shops load pictures as you scroll, so **scroll slowly to the
  bottom first**. Cards whose picture had not loaded are skipped with a warning.

Save with **Ctrl+S → Webpage, HTML only**, then use **Upload HTML** on the home
page (or the `/import` page). Category and channel come from the filename, for
example `Skirts, Shein.html`.

## 4. What gets stored

`catalogue_products`, one row per product:

| Column | Meaning |
| --- | --- |
| `platform` | `asos`, `temu` or `shein` |
| `product_id` | shop product ID (unique per platform; used for de-duplication) |
| `product_url` | product page on the shop's site (JSON `videoUrl`) |
| `title` | product name (JSON `videoTitle`) |
| `image_url` | product picture (JSON `imageUrl`) |
| `category` | from the JSON / filename |
| `channel_name` | label from the JSON, e.g. `ASOS` |
| `brand` | brand found on the page, or `null` |
| `import_batch_id` | the `video_import_batches` row it came from |

Re-importing a product that is already there skips it (it is not updated).

## 5. Reading products in the app

The table is publicly readable, so the product page can use the public
(anon) Supabase key:

```ts
const { data } = await supabase
  .from("catalogue_products")
  .select("id, platform, product_url, title, image_url, category, channel_name, brand")
  .order("created_at", { ascending: false })
  .range(0, 19)
```

Show `image_url` with a plain `<img referrerPolicy="no-referrer">` (or add the
shop image hosts to Next.js `images.remotePatterns`) and link it to
`product_url`. `components/video-card.tsx` in this tool does the same, with a
"Picture unavailable" fallback.

## Things to keep in mind

- Pictures are linked from the shop's servers, not copied. None of the three
  shops licenses reuse of their product photos; see
  `reports/Asos Temu Shein video import.md` for the terms.
- Shop page markup changes often, and the parser was built without real saved
  pages. Test it with a real saved page from each shop and add those pages as
  test fixtures.
