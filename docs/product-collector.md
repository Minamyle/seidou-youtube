# Product Collector

Merged from the `for_amina` repository. Paste a shop link, check the products,
and import them to `catalogue_products` for the product page. Products never
go to `catalogue_videos`, so they never appear in Seidou Social.

Open it from the **Product Collector** button on the home page, or at
`/products`.

## 1. Apply the migration

Run `supabase/migrations/20261123130000_product_collector.sql` once in the
Supabase SQL editor, after `20261123120000_move_retail_products_to_own_table.sql`.
It adds `description`, `price`, `price_text`, `previous_price_text`, `currency`
and `images` to `catalogue_products`, and the `import_product_batch` function.

## 2. Use it

1. Paste an ASOS category link, e.g.
   `https://www.asos.com/women/a-to-z-of-brands/mango/cat/?cid=8264`.
2. Choose how many products (up to 200) and optionally **Try full
   descriptions**.
3. **Collect products**, then check them in **Preview** or **JSON** (Copy and
   Download still work).
4. Set the **Category** (it starts as the shop's category name) and click
   **Import**.

Collecting the same products again **updates** their price, pictures and
description instead of skipping them.

## 3. Import a product JSON file

The **Import a JSON file** tab on `/products` works like the JSON Video Import
Form, for products:

1. Drop in a `.json` file. Two kinds are accepted:
   - `products.json` downloaded from the collector
   - the home page's **Export JSON** file; only its ASOS, Temu and SHEIN
     records are used (YouTube/X records are ignored with a note)
2. Check the **Category** (filled in from the file; every product in the
   import is saved under it).
3. Optionally add a **batch image** (JPEG, PNG or WebP). It is not required,
   because every product has its own picture; if added, it is stored in the
   `video-import-images` bucket and its path saved on the batch.
4. Read the validation summary, then **Import to Supabase**.

The server reads and checks the file again itself, then saves the products
with the same `import_product_batch` function as the collector.

## How it works

| Part | File |
| --- | --- |
| Page | `app/products/page.tsx`, `components/product-collector/product-collector.tsx` |
| Collect (server) | `app/api/products/collect/route.ts` → `lib/product-collector/asos.ts` or `generic.ts` |
| Import (server) | `app/api/products/import/route.ts` → `lib/product-collector/to-records.ts` → `import_product_batch` |
| Link safety check | `lib/product-collector/safety.ts` |

- **ASOS** is read from the category data feed the ASOS site itself uses. The
  product ID comes from the feed; ASOS grouped products have `/grp/<id>` links.
- **Other shops** are read from the page's JSON-LD, Open Graph tags or product
  cards. Only ASOS, Temu and SHEIN products are imported. Temu and SHEIN
  usually block server requests, so for them save the page as HTML and use the
  JSON Video Import Form instead; those products go to the same table.
- Every import is recorded in `video_import_batches`, like video imports.

## API

```
GET  /api/products/collect?url=<link>&limit=48&offset=0&details=1
POST /api/products/import   { "category": "...", "sourceUrl": "...", "products": [ ... ] }
```

`products` is the `products` array returned by collect.

## Limitations

- ASOS answers requests from a home connection. It may refuse requests from
  cloud servers (for example Vercel); if collecting fails once deployed, run
  the collector locally.
- Neither route has a login check, the same as the video import. Do not deploy
  this tool publicly without adding one, or anyone could use it to import
  products or make the server fetch pages.
- The shops' terms restrict automated collection and reuse of their content.
  Pictures are linked, not copied. Check the terms before using this
  commercially (see `reports/Asos Temu Shein video import.md`).
