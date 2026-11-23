-- Product Collector support (merged from the for_amina repository).
--
-- The collector reads products straight from a shop link, with more detail
-- than a saved HTML page gives: price, previous price, currency, description
-- and every picture. This adds those columns to catalogue_products and an
-- import function for collected products.
--
-- Collected products are only ever written to catalogue_products. They never
-- touch catalogue_videos, so they never reach Seidou Social.
--
-- Run once in the Supabase SQL editor after
-- 20261123120000_move_retail_products_to_own_table.sql.

begin;

alter table public.catalogue_products
  add column if not exists description text,
  add column if not exists price numeric(12, 2),
  add column if not exists price_text text,           -- as the shop shows it, e.g. "£49.99"
  add column if not exists previous_price_text text,  -- the crossed-out price, when on sale
  add column if not exists currency text,             -- e.g. GBP
  add column if not exists images text[] not null default '{}';

-- Rows imported from saved HTML pages have one picture; list it in images too.
update public.catalogue_products
set images = array[image_url]
where cardinality(images) = 0;

-- Imports collected products. A product that is already in the table (same
-- shop and product ID) is updated rather than skipped, because collecting
-- again is how prices and pictures are refreshed.
create or replace function public.import_product_batch(
  p_batch_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_inserted integer;
  v_updated integer;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Product records must be a JSON array';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_records) as r(platform text, product_id text, product_url text, title text, image_url text, category text)
    where r.platform is null or r.platform not in ('asos', 'temu', 'shein')
       or nullif(r.product_id, '') is null
       or nullif(r.product_url, '') is null
       or nullif(r.title, '') is null
       or nullif(r.image_url, '') is null
       or nullif(r.category, '') is null
  ) then
    raise exception 'Every product needs a supported shop, product ID, link, title, picture and category';
  end if;

  select count(*) into v_total from jsonb_array_elements(p_records);

  with incoming as (
    select distinct on (r.platform, r.product_id) r.*
    from jsonb_to_recordset(p_records) as r(
      platform text,
      product_id text,
      product_url text,
      title text,
      image_url text,
      images text[],
      category text,
      channel_name text,
      brand text,
      description text,
      price numeric,
      price_text text,
      previous_price_text text,
      currency text
    )
    order by r.platform, r.product_id
  ),
  saved as (
    insert into public.catalogue_products as p (
      platform, product_id, product_url, title, image_url, images, category,
      channel_name, brand, description, price, price_text, previous_price_text,
      currency, import_batch_id
    )
    select
      i.platform, i.product_id, i.product_url, i.title, i.image_url,
      coalesce(i.images, array[i.image_url]), i.category,
      coalesce(nullif(i.channel_name, ''), initcap(i.platform)),
      nullif(i.brand, ''), nullif(i.description, ''), i.price,
      nullif(i.price_text, ''), nullif(i.previous_price_text, ''),
      upper(nullif(i.currency, '')), p_batch_id
    from incoming i
    on conflict (platform, product_id) do update set
      product_url         = excluded.product_url,
      title               = excluded.title,
      image_url           = excluded.image_url,
      images              = excluded.images,
      category            = excluded.category,
      brand               = coalesce(excluded.brand, p.brand),
      description         = coalesce(excluded.description, p.description),
      price               = excluded.price,
      price_text          = excluded.price_text,
      previous_price_text = excluded.previous_price_text,
      currency            = coalesce(excluded.currency, p.currency),
      import_batch_id     = excluded.import_batch_id
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*) filter (where not was_inserted)
  into v_inserted, v_updated
  from saved;

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
    'updated', v_updated,
    'skipped', v_total - v_inserted - v_updated
  );
end;
$$;

revoke execute on function public.import_product_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_product_batch(uuid, jsonb) to service_role;

commit;
