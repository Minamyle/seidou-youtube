# How to add ASOS, Temu and SHEIN products to Seidou

This guide shows you how to take products from **ASOS**, **Temu** or **SHEIN**
and put them in the Seidou app, with their pictures, names and prices. You
don't need any technical knowledge. If you can browse a shopping website and
save a page, you can do this.

It takes about **5 minutes per page**, and one page usually gives you
**40 to 120 products** at once.

---

## How it works, in one sentence

You open a shop page in your browser, save it to your computer, and upload
that saved page to Seidou's **Product Import** page. Seidou reads every product
on it and adds them to the app.

> **Why not just paste a link?** Temu and SHEIN block tools that try to read
> their pages automatically. A page that *you* opened in your own browser
> works every time, because the shop treats you as a normal shopper.

---

## What you need

- A **computer** (Windows or Mac) with **Google Chrome** or **Microsoft Edge**.
  Saving pages doesn't work properly from a phone.
- The **Product Import** page of the Seidou import tool, for example
  `https://seidou-youtube.vercel.app/products`. Ask the team for the right link
  if you're not sure.
- About 5 minutes.

---

## Step 1: Open a good page on the shop's website

Pick a page that **lists many products**, not a single product.

| Shop | Good pages to use | Example |
| --- | --- | --- |
| **ASOS** | A category page or a brand page | `asos.com` → Women → Dresses |
| **Temu** | A search result or category page | Search "women's dresses" on `temu.com` |
| **SHEIN** | A category page | `shein.com` → Men → Clothing |

Tips:

- **Use the Nigerian Temu site** (the web address contains `/ng/`) so prices
  come in naira. US-dollar and British-pound prices are converted to naira
  automatically, so other countries' sites work too.
- **Clothing, shoes and bags work best.** Seidou puts products into categories
  (Dresses, T-Shirts, Heels…) by reading their names. Products like phone
  cases or kitchen items won't have a category and won't appear.
- If the shop shows a **"Verify you are human"** box or a puzzle, just
  complete it. That's normal.

---

## Step 2: Load all the products on the page

Shops only load products as you scroll, so you need to let them appear first.

1. **Scroll down slowly** to the bottom of the page.
2. **Wait until every product shows its picture and price.** If some cards
   are grey or blank, scroll back up and down over them until they load.
3. If there's a **"Load more"** or **"See more"** button at the bottom, click
   it and scroll again. Stop when you have enough products (up to about 120
   per page is ideal).

> **This is the most important step.** Anything that hasn't loaded on your
> screen won't be in the saved page: no picture means the product is skipped,
> and no price means it won't show in the app.

---

## Step 3: Save the page to your computer

1. Press **Ctrl + S** on Windows, or **Cmd + S** on Mac.
2. In the window that opens, find **"Save as type"** (Windows) or
   **"Format"** (Mac) and choose **"Webpage, HTML Only"**.
3. Give the file a clear name, for example `Women Dresses Temu.html`.
4. Save it to a place you can find again, such as your **Downloads** folder.

You'll get a file ending in **`.html`**. That's the one you need. (If a folder
with the same name also appears, you can ignore it.)

---

## Step 4: Upload the saved page to Product Import

1. Open the **Product Import** page of the Seidou import tool.
2. Click the tab **"Import a saved page or file"**.
3. Drag your `.html` file into the box that says **"Drag a saved shop page (.html)
   or a .json file here"**. Or click **Choose File** and pick it.

After a few seconds you'll see:

- the file name with a **"Saved shop page"** label and a **"Valid"** badge
- a **Validation summary**, for example *"120 of 120 products will be imported"*
- the shop and how many products came from it (for example **SHEIN: 120**)
- small pictures of the first few products

**Check the pictures look right.** If they do, carry on.

---

## Step 5: Check the category name

The **Category** box is filled in from the page's name. It's just a label to
help you find this batch later; you can leave it as it is or change it to
something short like `Women Dresses`.

> You don't need to sort products into categories yourself. Seidou reads each
> product's name and places it automatically: "Floral Midi Dress" goes into
> **Dresses**, "Men's Polo Shirt" into **Polo Shirts**, and so on.

**Batch Image:** leave it empty. It's optional, because every product already
has its own picture.

---

## Step 6: Import

1. Click **Import to Supabase**.
2. Wait a few seconds, keeping the page open.
3. You'll see **Import succeeded** with three numbers:

| Number | What it means |
| --- | --- |
| **Added** | New products added to the app |
| **Updated** | Products that were already there; their price and pictures were refreshed |
| **Skipped** | Products that couldn't be added (see "If something goes wrong" below) |

That's it. You can click **Start another import** to do the next page.

---

## Step 7: See your products in the app

There's nothing to publish: products appear in the Seidou app **straight
away**. Refresh the app and look in:

- **Explore**: open the matching section. Women's products are under
  **Women's Fashion** (Dresses, Skirts, Heels, Bags…), men's products under
  **Men's Fashion** (Polo Shirts, T-Shirts, Short Sleeve Shirts, Coats &
  Jackets…).
- **Home**: imported products appear in the category tabs, and further down
  the main feed after Seidou's own products. **Explore** is the quickest place
  to find them.

Prices are shown in **naira (₦)**:

- Temu Nigeria prices are already in naira.
- SHEIN and US ASOS prices (dollars) are converted at **₦1,360 per $1**.
- UK ASOS prices (pounds) are converted at **₦2,000 per £1**.

Tapping a product opens its details: its pictures, price, and description when
the shop provides one.

---

## Keeping prices up to date

Shops change their prices often. To refresh them, **just repeat Steps 1 to 6
with the same page**. Products that are already in the app are **updated,
not duplicated**, so you'll see them under **Updated**, not **Added**.

---

## If something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| **"This page is not from ASOS, Temu or SHEIN"** | The file was saved from another website | Save a page from one of the three shops |
| **"No products were found in this … page"** | The page was saved before the products loaded | Go back to Step 2, scroll until everything loads, and save again |
| **"X products were skipped because no picture had loaded"** | Some product pictures hadn't loaded when you saved | Scroll slowly over the whole page, then save again. The rest still imports fine |
| **"X of Y products have no price on the saved page"** | Some prices hadn't loaded | Those products won't show in the app. Scroll until every price shows, save again and re-import |
| **"This is a products file … not a video file"** | You used the **video** import form by mistake | Click **Product Import** at the top of that page and use it instead |
| **"Picture unavailable"** on a product | The shop's picture link stopped working | Import the page again to refresh the pictures |
| A **captcha or "verify you're human"** page on the shop | The shop is checking you're a real person | Complete it, then continue from Step 2 |
| The page saved, but the file is **tiny** or shows a blank page when opened | You saved a "checking your browser" page | Wait until the real products appear on screen, then save again |
| **A product doesn't appear** in the app | It has no price, or its name doesn't say what it is (for example a name with no "dress", "shirt", "bag"…) | Check it had a price when you saved. Products with unclear names can't be placed in a category |

---

## Extra: ASOS straight from a link

For **ASOS only**, there's a second way that doesn't need saving a page: the
**"Collect from a link"** tab. Paste an ASOS category link, choose how many
products (up to 200), click **Collect products**, then **Import**.

This only works when the import tool runs **on your own computer**. ASOS
doesn't answer requests from the online version, and you'll see a message
saying so. If that happens, use the saved-page method above instead; it gives
the same result.

---

## Please remember

- **Only take what you need.** Collect the pages you actually want in the
  app; don't save hundreds of pages at once.
- **The products still belong to the shops.** Seidou shows their pictures,
  names and prices, which remain the shops' content. Check with the team
  before using them for anything beyond the app.

---

## Quick checklist

1. Open a list page on ASOS, Temu or SHEIN (clothing, shoes or bags).
2. Scroll slowly to the bottom; wait for every picture **and price**.
3. **Ctrl + S** → **"Webpage, HTML Only"** → save.
4. Product Import → **Import a saved page or file** → drop the `.html` file.
5. Check the pictures, leave the batch image empty.
6. **Import to Supabase** → look for **Import succeeded**.
7. Refresh the Seidou app and find the products under **Explore**.
