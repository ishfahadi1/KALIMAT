-- Applied to the KALIMAT Supabase project. One table holds every collection (products, orders, config ...), scoped by shop_id.
create table public.records (
  shop_id text not null, coll text not null, id text not null,
  data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
  primary key (shop_id, coll, id));
create table public.shop_admins (shop_id text not null, email text not null, primary key (shop_id, email));
create table public.admin_totp (
  email text primary key, shop_id text not null, secret text not null,
  enrolled boolean not null default false, fails int not null default 0,
  locked_until timestamptz, last_step bigint not null default 0, setup_key_hash text);
create table public.admin_setup (
  key_hash text primary key, shop_id text not null, used boolean not null default false,
  created_at timestamptz not null default now());
alter table public.records enable row level security;
alter table public.shop_admins enable row level security;
alter table public.admin_totp enable row level security;   -- no policies: only the Edge Function (service role) can touch these
alter table public.admin_setup enable row level security;

create function public.is_admin(s text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.shop_admins where shop_id = s and lower(email) = lower(coalesce(auth.jwt()->>'email',''))) $$;

create policy admin_all on public.records for all to authenticated
  using (public.is_admin(shop_id)) with check (public.is_admin(shop_id));
create policy public_read on public.records for select to anon, authenticated
  using (coll in ('config','categories','promotions','policies','businessProfile','tutorial'));
create policy shopper_insert on public.records for insert to anon, authenticated
  with check (coll in ('orders','customers','customerDemands') and length(id) < 64 and pg_column_size(data) < 20000);

-- Products for shoppers WITHOUT cost price, supplier, SKU or minimum stock (intentionally a definer view).
create view public.public_products as
  select shop_id, id, data - 'costPrice' - 'vendorId' - 'minStock' - 'sku' as data
  from public.records where coll = 'products';
grant select on public.public_products to anon, authenticated;

create function public.reserve_product(p_shop text, p_id text, p_order text) returns boolean
  language plpgsql security definer set search_path = public as $$
declare n int; begin
  update public.records set data = data || jsonb_build_object('stock',0,'sale','reserved','reservedBy',p_order), updated_at = now()
   where shop_id = p_shop and coll = 'products' and id = p_id
     and coalesce((data->>'stock')::int,0) > 0 and coalesce(data->>'sale','available') = 'available';
  get diagnostics n = row_count; return n > 0; end $$;
grant execute on function public.reserve_product(text,text,text) to anon, authenticated;

create function public.release_stale_reservations() returns void
  language sql security definer set search_path = public as $$
  with o as (
    update public.records set data = data || jsonb_build_object('status','cancelled',
      'history', coalesce(data->'history','[]'::jsonb) || jsonb_build_array(jsonb_build_object('status','cancelled','at',now(),'note','Released automatically: not confirmed within 24 hours')))
    where coll = 'orders' and data->>'status' = 'pending' and (data->>'date')::timestamptz < now() - interval '24 hours'
      and coalesce(data->>'productId','') <> '' returning shop_id, data->>'productId' as pid)
  update public.records p set data = p.data || '{"stock":1,"sale":"available","reservedBy":null}'::jsonb
    from o where p.coll = 'products' and p.shop_id = o.shop_id and p.id = o.pid and p.data->>'sale' = 'reserved' $$;
revoke all on function public.release_stale_reservations() from public, anon, authenticated;

-- Runs every 10 minutes (pg_cron):
-- select cron.schedule('kalimat-release-stale','*/10 * * * *','select public.release_stale_reservations()');
