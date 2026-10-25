-- 004: push notifications (admin: new order / new customer, shoppers: new product).
-- Run once in the Supabase SQL editor (project zjppqyktqhjoyfkhvpyh) AFTER 001-003. Safe to re-run.
-- Then deploy the edge function supabase/functions/kal-push (Verify JWT = OFF). Nothing else to configure:
-- the function creates its own push keys the first time it runs.

create extension if not exists pg_net with schema extensions;

-- One row per phone/browser that agreed to notifications. Only the edge function (service role) can touch it.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  shop_id    text not null,
  role       text not null check (role in ('admin','customer')),
  email      text,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_shop_role on public.push_subscriptions (shop_id, role);

-- Push keys and the private link between the database and the function. Never readable from the browser.
create table if not exists public.push_config (key text primary key, value text not null);

alter table public.push_subscriptions enable row level security;   -- no policies on purpose
alter table public.push_config        enable row level security;   -- no policies on purpose
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_config        from anon, authenticated;

insert into public.push_config (key, value)
values ('webhook_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- After a new order, customer or product is saved, tell the function. A failure here can NEVER block the order itself.
create or replace function private.notify_push() returns trigger
  language plpgsql security definer set search_path = public, extensions, net as $$
declare sec text;
begin
  select value into sec from public.push_config where key = 'webhook_secret';
  if sec is null then return new; end if;
  perform net.http_post(
    url     := 'https://zjppqyktqhjoyfkhvpyh.supabase.co/functions/v1/kal-push',
    headers := jsonb_build_object('Content-Type','application/json','x-kal-secret',sec),
    body    := jsonb_build_object('action','notify','shop_id',new.shop_id,'coll',new.coll,'id',new.id),
    timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;
end $$;
revoke all on function private.notify_push() from public, anon, authenticated;

drop trigger if exists records_push on public.records;
create trigger records_push after insert on public.records
  for each row when (new.coll in ('orders','customers','products'))
  execute function private.notify_push();
