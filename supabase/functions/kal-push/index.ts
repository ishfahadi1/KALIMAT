// kal-push: web push for KALIMAT. Deploy with "Verify JWT" OFF (it checks its own secret / admin session).
//   key         (public)  -> the public push key the browser needs
//   subscribe   (public)  -> save a phone; role "admin" needs a signed-in admin session
//   unsubscribe (public)  -> forget a phone
//   notify      (database)-> sent by the records trigger with the private x-kal-secret header
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---- keys: created once, stored in push_config, never leave the server (except the public half) ----
let cfg: { pub: string; priv: string; secret: string } | null = null;
async function config() {
  if (cfg) return cfg;
  const read = async () => {
    const { data } = await db.from('push_config').select('key,value');
    const m: Record<string, string> = {};
    (data || []).forEach((r: any) => (m[r.key] = r.value));
    return m;
  };
  let m = await read();
  if (!m.vapid_public || !m.vapid_private) {
    const k = webpush.generateVAPIDKeys();
    // "ignoreDuplicates": if two requests race, the first pair wins and both read it back below.
    await db.from('push_config').upsert(
      [{ key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }],
      { onConflict: 'key', ignoreDuplicates: true });
    m = await read();
  }
  if (!m.vapid_public || !m.vapid_private || !m.webhook_secret) throw new Error('push_config_incomplete');
  webpush.setVapidDetails('https://kalimat.co.rw', m.vapid_public, m.vapid_private);
  cfg = { pub: m.vapid_public, priv: m.vapid_private, secret: m.webhook_secret };
  return cfg;
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function adminEmail(req: Request, shop: string): Promise<string | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: row } = await db.from('shop_admins').select('email').eq('shop_id', shop).eq('email', email).maybeSingle();
  return row ? email : null;
}

async function send(rows: any[], payload: unknown) {
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  const res = await Promise.allSettled(rows.map((r) =>
    webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, { TTL: 86400 })
      .catch((e: any) => { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(r.endpoint); throw e; })));
  if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);
  return { sent: res.filter((r) => r.status === 'fulfilled').length, failed: res.filter((r) => r.status === 'rejected').length, removed: dead.length };
}

const clip = (v: unknown, n: number) => String(v ?? '').slice(0, n);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  try {
    const c = await config();

    if (b.action === 'key') return json({ publicKey: c.pub });

    if (b.action === 'subscribe') {
      const s = b.subscription, shop = clip(b.shop_id, 64);
      if (!shop || !s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || s.endpoint.length > 600 ||
          !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string' ||
          s.keys.p256dh.length > 200 || s.keys.auth.length > 100) return json({ error: 'bad_subscription' }, 400);
      let role = 'customer', email: string | null = null;
      if (b.role === 'admin') {
        email = await adminEmail(req, shop);
        if (!email) return json({ error: 'not_admin' }, 403);
        role = 'admin';
      } else {
        // A phone already registered as admin stays admin when it also visits the storefront.
        const { data: ex } = await db.from('push_subscriptions').select('role').eq('endpoint', s.endpoint).maybeSingle();
        if (ex?.role === 'admin') return json({ ok: true, role: 'admin' });
      }
      const { error } = await db.from('push_subscriptions').upsert({
        endpoint: s.endpoint, shop_id: shop, role, email, p256dh: s.keys.p256dh, auth: s.keys.auth, updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });
      if (error) return json({ error: 'save_failed' }, 500);
      return json({ ok: true, role });
    }

    if (b.action === 'unsubscribe') {
      if (typeof b.endpoint === 'string') await db.from('push_subscriptions').delete().eq('endpoint', b.endpoint);
      return json({ ok: true });
    }

    if (b.action === 'notify') {
      if (!same(req.headers.get('x-kal-secret') || '', c.secret)) return json({ error: 'forbidden' }, 403);
      const shop = clip(b.shop_id, 64), coll = clip(b.coll, 32), id = clip(b.id, 64);
      const { data: rec } = await db.from('records').select('data').eq('shop_id', shop).eq('coll', coll).eq('id', id).maybeSingle();
      if (!rec) return json({ ok: true, skipped: 'no_record' });
      const d: any = rec.data || {};
      const { data: conf } = await db.from('records').select('data').eq('shop_id', shop).eq('coll', 'config').eq('id', '_').maybeSingle();
      const cur = clip((conf?.data as any)?.general?.currency || 'RWF', 8);
      const money = (n: unknown) => cur + ' ' + Number(n || 0).toLocaleString('en-US');

      let role = 'admin', payload: any = null;
      if (coll === 'orders') {
        if (d.status === 'cancelled') return json({ ok: true, skipped: 'cancelled' });
        payload = { title: 'New order ' + clip(d.number, 24), body: clip(d.customerName, 40) + ' · ' + clip(d.item, 60) + ' · ' + money(d.amount),
          tag: 'kal-order-' + id, url: '/admin', icon: '/admin-icon-192.png' };
      } else if (coll === 'customers') {
        payload = { title: 'New customer', body: clip(d.name, 60) || 'Someone just signed up', tag: 'kal-customer-' + id, url: '/admin', icon: '/admin-icon-192.png' };
      } else if (coll === 'products') {
        role = 'customer';
        if ((d.status && d.status !== 'active') || (d.sale && d.sale !== 'available') || !(Number(d.stock ?? 1) > 0)) return json({ ok: true, skipped: 'not_for_sale' });
        // same tag for every product: a burst of new products collapses into one notification on the phone
        payload = { title: 'New in KALIMAT', body: clip(d.name, 80) + (d.price ? ' · ' + money(d.price) : ''), tag: 'kal-new-product', url: '/', icon: '/icon-192.png' };
      } else return json({ ok: true, skipped: 'ignored' });

      const { data: rows } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('shop_id', shop).eq('role', role).limit(5000);
      if (!rows?.length) return json({ ok: true, sent: 0 });
      return json({ ok: true, ...(await send(rows, payload)) });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('[kal-push]', e);
    return json({ error: 'server_error' }, 500);
  }
});
