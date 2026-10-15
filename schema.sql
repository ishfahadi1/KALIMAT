-- KALIMAT backend. Run once in the Supabase SQL editor of the KALIMAT project.
-- One table holds every collection the app uses (products, orders, customers, config ...), scoped by shop_id.

create table if not exists public.records (
  shop_id text not null, coll text not null, id text not null,
  data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
  primary key (shop_id, coll, id));
create table if not exists public.shop_admins (
  shop_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  primary key (shop_id, user_id));
alter table public.records enable row level security;
alter table public.shop_admins enable row level security;

create or replace function public.is_admin(s text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.shop_admins where shop_id = s and user_id = auth.uid()) $$;

-- Owner/admins: full access to everything in their shop.
create policy admin_all on public.records for all to authenticated
  using (public.is_admin(shop_id)) with check (public.is_admin(shop_id));
-- Shoppers: read only what the storefront shows (products come from the safe view below).
create policy public_read on public.records for select to anon, authenticated
  using (coll in ('config','categories','promotions','policies','businessProfile','tutorial'));
-- Shoppers: may create (never read or change) their own orders, requests and customer record.
create policy shopper_insert on public.records for insert to anon, authenticated
  with check (coll in ('orders','customers','customerDemands'));

-- Products for shoppers WITHOUT cost price, supplier, SKU or minimum stock.
create or replace view public.public_products as
  select shop_id, id, data - 'costPrice' - 'vendorId' - 'minStock' - 'sku' as data
  from public.records where coll = 'products';
grant select on public.public_products to anon, authenticated;

-- Reserve a product for an order. Atomic, so two shoppers can never get the same item.
create or replace function public.reserve_product(p_shop text, p_id text, p_order text) returns boolean
  language plpgsql security definer set search_path = public as $$
declare n int; begin
  update public.records set data = data || jsonb_build_object('stock',0,'sale','reserved','reservedBy',p_order), updated_at = now()
   where shop_id = p_shop and coll = 'products' and id = p_id
     and coalesce((data->>'stock')::int,0) > 0 and coalesce(data->>'sale','available') = 'available';
  get diagnostics n = row_count; return n > 0; end $$;
grant execute on function public.reserve_product(text,text,text) to anon, authenticated;

-- Pending orders not confirmed within 24h are cancelled and the product is released.
create or replace function public.release_stale_reservations() returns void
  language sql security definer set search_path = public as $$
  with o as (
    update public.records set data = data || jsonb_build_object('status','cancelled',
      'history', coalesce(data->'history','[]'::jsonb) || jsonb_build_array(jsonb_build_object('status','cancelled','at',now(),'note','Released automatically: not confirmed within 24 hours')))
    where coll = 'orders' and data->>'status' = 'pending' and (data->>'date')::timestamptz < now() - interval '24 hours'
      and coalesce(data->>'productId','') <> '' returning shop_id, data->>'productId' as pid)
  update public.records p set data = p.data || '{"stock":1,"sale":"available","reservedBy":null}'::jsonb
    from o where p.coll = 'products' and p.shop_id = o.shop_id and p.id = o.pid and p.data->>'sale' = 'reserved' $$;
-- Enable pg_cron (Database > Extensions), then:
-- select cron.schedule('release-stale','*/10 * * * *','select public.release_stale_reservations()');

-- Make someone an admin: create the user in Authentication > Users, then (use your SHOP_ID and their id):
-- insert into public.shop_admins (shop_id, user_id) values ('your-shop-id', '<user uuid>');
