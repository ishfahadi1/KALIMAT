-- 003: a product can only be reserved by a real, pending order for that exact product.
-- Before this, any anonymous caller could call reserve_product with any product id and mark it "finished".
-- Apply in the Supabase SQL editor after 001 and 002. Safe to re-run (create or replace).
create or replace function public.reserve_product(p_shop text, p_id text, p_order text) returns boolean
  language plpgsql security definer set search_path = public as $$
declare n int; begin
  if not exists (
    select 1 from public.records o
     where o.shop_id = p_shop and o.coll = 'orders' and o.id = p_order
       and o.data->>'productId' = p_id
       and coalesce(o.data->>'status','pending') = 'pending'
  ) then
    return false;
  end if;
  update public.records set data = data || jsonb_build_object('stock',0,'sale','reserved','reservedBy',p_order), updated_at = now()
   where shop_id = p_shop and coll = 'products' and id = p_id
     and coalesce((data->>'stock')::int,0) > 0 and coalesce(data->>'sale','available') = 'available';
  get diagnostics n = row_count; return n > 0; end $$;
grant execute on function public.reserve_product(text,text,text) to anon, authenticated;
