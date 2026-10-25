-- 005: customer accounts without OTP and without cost.
-- A customer is identified by the pair (username, phone). The same pair on any device returns the same orders and requests.
-- Safety: 8 wrong tries per phone lock that phone for 15 minutes; every function returns ONLY the caller's own records;
-- shoppers can no longer write to the customers table directly (they go through these functions).

create table if not exists public.customer_login_attempts (
  shop_id text not null, phone9 text not null, fails int not null default 0, locked_until timestamptz,
  primary key (shop_id, phone9));
alter table public.customer_login_attempts enable row level security;   -- no policies: only the functions below can touch it

create or replace function private.ph9(p text) returns text language sql immutable set search_path = '' as
$$ select right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 9) $$;

-- every customer row matching the pair (old duplicates included), oldest first
create or replace function private.cust_ids(p_shop text, p_user text, p_phone text) returns text[]
  language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(r.id order by coalesce(r.data->>'joinedAt','')), '{}'::text[])
     from public.records r
    where r.shop_id = p_shop and r.coll = 'customers'
      and btrim(coalesce(p_user,'')) <> '' and length(private.ph9(p_phone)) = 9
      and lower(btrim(coalesce(r.data->>'username',''))) = lower(btrim(p_user))
      and private.ph9(r.data->>'phone') = private.ph9(p_phone) $$;

-- checks the pair, counts failures, locks after 8
create or replace function private.cust_auth(p_shop text, p_user text, p_phone text) returns text[]
  language plpgsql security definer set search_path = public as $$
declare ph text := private.ph9(p_phone); ids text[]; a public.customer_login_attempts; nf int;
begin
  if length(ph) <> 9 then return '{}'::text[]; end if;
  select * into a from public.customer_login_attempts where shop_id = p_shop and phone9 = ph;
  if found and a.locked_until is not null and a.locked_until > now() then raise exception 'locked'; end if;
  ids := private.cust_ids(p_shop, p_user, p_phone);
  if cardinality(ids) = 0 then
    nf := case when found and a.locked_until is not null and a.locked_until <= now() then 1 when found then a.fails + 1 else 1 end;
    insert into public.customer_login_attempts(shop_id, phone9, fails, locked_until)
      values (p_shop, ph, nf, case when nf >= 8 then now() + interval '15 minutes' end)
      on conflict (shop_id, phone9) do update set fails = excluded.fails, locked_until = excluded.locked_until;
    return '{}'::text[];
  end if;
  delete from public.customer_login_attempts where shop_id = p_shop and phone9 = ph;
  return ids;
end $$;

create or replace function private.cust_json(p_shop text, p_id text) returns jsonb
  language sql stable security definer set search_path = public as
$$ select jsonb_build_object('id', r.id, 'name', r.data->>'name', 'username', r.data->>'username', 'phone', r.data->>'phone',
        'email', coalesce(r.data->>'email',''), 'address', coalesce(r.data->'addresses'->0->>'line',''))
     from public.records r where r.shop_id = p_shop and r.coll = 'customers' and r.id = p_id $$;

create or replace function public.customer_login(p_shop text, p_username text, p_phone text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare ids text[];
begin
  ids := private.cust_auth(p_shop, p_username, p_phone);
  if cardinality(ids) = 0 then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('customer', private.cust_json(p_shop, ids[1]));
end $$;

create or replace function public.customer_register(p_shop text, p_username text, p_phone text, p_name text, p_email text, p_address text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare un text := lower(btrim(coalesce(p_username,''))); ph text := private.ph9(p_phone); ids text[]; nid text; n int; addr text := btrim(coalesce(p_address,''));
begin
  if un !~ '^[a-z0-9._-]{3,24}$' then raise exception 'bad_username'; end if;
  if length(ph) <> 9 then raise exception 'bad_phone'; end if;
  if length(btrim(coalesce(p_name,''))) < 2 or length(p_name) > 80 then raise exception 'bad_name'; end if;
  if length(coalesce(p_email,'')) > 120 or length(addr) > 300 then raise exception 'too_long'; end if;
  ids := private.cust_auth(p_shop, un, p_phone);                       -- an existing pair simply signs in (counted + locked like a login)
  if cardinality(ids) > 0 then return jsonb_build_object('customer', private.cust_json(p_shop, ids[1]), 'existed', true); end if;
  select count(*) into n from public.records r where r.shop_id = p_shop and r.coll = 'customers' and coalesce(r.data->>'username','') <> '' and private.ph9(r.data->>'phone') = ph;
  if n >= 5 then raise exception 'too_many'; end if;
  nid := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into public.records(shop_id, coll, id, data) values (p_shop, 'customers', nid, jsonb_build_object(
    'id', nid, 'shopId', p_shop, 'name', btrim(p_name), 'username', un, 'email', btrim(coalesce(p_email,'')), 'phone', btrim(p_phone), 'contact', btrim(p_phone),
    'addresses', case when addr <> '' then jsonb_build_array(jsonb_build_object('id', 'a_' || substr(nid, 3), 'label', 'Home', 'line', addr, 'city', '')) else '[]'::jsonb end,
    'joinedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'notes', 'Created from the online store'));
  return jsonb_build_object('customer', private.cust_json(p_shop, nid), 'existed', false);
end $$;

create or replace function public.customer_activity(p_shop text, p_username text, p_phone text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare ids text[];
begin
  ids := private.cust_auth(p_shop, p_username, p_phone);
  if cardinality(ids) = 0 then raise exception 'denied'; end if;
  return jsonb_build_object('customer', private.cust_json(p_shop, ids[1]),
    'orders', coalesce((select jsonb_agg(o.data - 'adminNotes' - 'profit' - 'cost' order by o.data->>'date' desc)
                          from (select data from public.records where shop_id = p_shop and coll = 'orders' and data->>'customerId' = any(ids) order by data->>'date' desc limit 200) o), '[]'::jsonb),
    'demands', coalesce((select jsonb_agg(d.data - 'adminNotes' - 'assignedTo' order by d.data->>'date' desc)
                          from (select data from public.records where shop_id = p_shop and coll = 'customerDemands' and data->>'customerId' = any(ids) order by data->>'date' desc limit 200) d), '[]'::jsonb));
end $$;

create or replace function public.customer_save(p_shop text, p_username text, p_phone text, p_name text, p_email text, p_address text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare ids text[]; addr text := btrim(coalesce(p_address,''));
begin
  ids := private.cust_auth(p_shop, p_username, p_phone);
  if cardinality(ids) = 0 then raise exception 'denied'; end if;
  if length(btrim(coalesce(p_name,''))) < 2 or length(p_name) > 80 then raise exception 'bad_name'; end if;
  if length(coalesce(p_email,'')) > 120 or length(addr) > 300 then raise exception 'too_long'; end if;
  update public.records set updated_at = now(), data = data
      || jsonb_build_object('name', btrim(p_name), 'email', btrim(coalesce(p_email,'')))
      || case when addr <> '' then jsonb_build_object('addresses', jsonb_set(coalesce(data->'addresses', '[]'::jsonb), '{0}',
           jsonb_build_object('id', coalesce(data->'addresses'->0->>'id', 'a_' || substr(id, 3)), 'label', coalesce(data->'addresses'->0->>'label', 'Home'), 'line', addr, 'city', coalesce(data->'addresses'->0->>'city', '')))) else '{}'::jsonb end
    where shop_id = p_shop and coll = 'customers' and id = ids[1];
  return private.cust_json(p_shop, ids[1]);
end $$;

-- the customer accepts or declines a quote that the shop sent (only their own request, only while it is "quoted")
create or replace function public.customer_answer_demand(p_shop text, p_username text, p_phone text, p_demand_id text, p_status text) returns boolean
  language plpgsql security definer set search_path = public as $$
declare ids text[]; n int;
begin
  if p_status not in ('accepted', 'cancelled') then raise exception 'bad_status'; end if;
  ids := private.cust_auth(p_shop, p_username, p_phone);
  if cardinality(ids) = 0 then raise exception 'denied'; end if;
  update public.records set updated_at = now(), data = data || jsonb_build_object('status', p_status)
   where shop_id = p_shop and coll = 'customerDemands' and id = p_demand_id and data->>'customerId' = any(ids) and data->>'status' = 'quoted';
  get diagnostics n = row_count; return n > 0;
end $$;

-- a visitor without an account who sends a request: one shared "guest" customer per phone (never an account)
create or replace function public.customer_guest(p_shop text, p_name text, p_phone text, p_address text) returns text
  language plpgsql security definer set search_path = public as $$
declare ph text := private.ph9(p_phone); gid text; addr text := btrim(coalesce(p_address,''));
begin
  if length(ph) <> 9 then raise exception 'bad_phone'; end if;
  if length(btrim(coalesce(p_name,''))) < 2 or length(p_name) > 80 or length(addr) > 300 then raise exception 'bad_name'; end if;
  select r.id into gid from public.records r where r.shop_id = p_shop and r.coll = 'customers' and coalesce(r.data->>'username','') = '' and private.ph9(r.data->>'phone') = ph
   order by coalesce(r.data->>'joinedAt','') limit 1;
  if gid is not null then return gid; end if;
  gid := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into public.records(shop_id, coll, id, data) values (p_shop, 'customers', gid, jsonb_build_object(
    'id', gid, 'shopId', p_shop, 'name', btrim(p_name), 'email', '', 'phone', btrim(p_phone), 'contact', btrim(p_phone),
    'addresses', case when addr <> '' then jsonb_build_array(jsonb_build_object('id', 'a_' || substr(gid, 3), 'label', 'Home', 'line', addr, 'city', '')) else '[]'::jsonb end,
    'joinedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'notes', 'Guest request from the online store'));
  return gid;
end $$;

revoke all on function private.ph9(text), private.cust_ids(text,text,text), private.cust_auth(text,text,text), private.cust_json(text,text) from public, anon, authenticated;
grant execute on function public.customer_login(text,text,text), public.customer_register(text,text,text,text,text,text), public.customer_activity(text,text,text),
  public.customer_save(text,text,text,text,text,text), public.customer_answer_demand(text,text,text,text,text), public.customer_guest(text,text,text,text) to anon, authenticated;

-- shoppers no longer insert customer rows themselves
drop policy if exists shopper_insert on public.records;
create policy shopper_insert on public.records for insert to anon, authenticated
  with check (coll in ('orders', 'customerDemands') and length(id) < 64 and pg_column_size(data) < 20000);
