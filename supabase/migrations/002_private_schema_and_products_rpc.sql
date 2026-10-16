-- 1) is_admin lives in a schema the API does not expose, so it is not callable as /rpc/is_admin
create schema if not exists private;
grant usage on schema private to anon, authenticated;
create function private.is_admin(s text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.shop_admins where shop_id = s and lower(email) = lower(coalesce(auth.jwt()->>'email',''))) $$;
grant execute on function private.is_admin(text) to anon, authenticated;
drop policy admin_all on public.records;
create policy admin_all on public.records for all to authenticated
  using (private.is_admin(shop_id)) with check (private.is_admin(shop_id));
drop function public.is_admin(text);

-- 2) shoppers read products through a function (no cost price / supplier / SKU / min stock)
drop view public.public_products;
create function public.public_products(p_shop text) returns table(id text, data jsonb)
  language sql stable security definer set search_path = public as
$$ select r.id, r.data - 'costPrice' - 'vendorId' - 'minStock' - 'sku' from public.records r where r.shop_id = p_shop and r.coll = 'products' $$;
grant execute on function public.public_products(text) to anon, authenticated;
