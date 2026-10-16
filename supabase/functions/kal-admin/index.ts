import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';
import { b32encode, matchStep, sha256hex } from './totp.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const MAX_FAILS = 5;
const LOCK_MIN = 15;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return json({ error: 'bad_email' }, 400);

  const { data: t } = await admin.from('admin_totp').select('*').eq('email', email).maybeSingle();

  // Does this email already have an authenticator? (Unknown emails look the same as "not set up".)
  if (b.action === 'status') return json({ enrolled: !!t?.enrolled });

  // First-time setup (or new phone): needs a one-time setup key. Nothing is trusted until a first code is confirmed.
  if (b.action === 'enroll') {
    const keyHash = await sha256hex(String(b.setup_key || '').trim().toUpperCase());
    const { data: k } = await admin.from('admin_setup').select('shop_id, used').eq('key_hash', keyHash).maybeSingle();
    if (!k || k.used) return json({ error: 'bad_key' }, 403);
    const secret = b32encode(crypto.getRandomValues(new Uint8Array(20)));
    const { error } = await admin.from('admin_totp').upsert({
      email, shop_id: k.shop_id, secret, enrolled: false, fails: 0, locked_until: null, last_step: 0, setup_key_hash: keyHash,
    });
    if (error) return json({ error: 'enroll_failed' }, 500);
    const uri = 'otpauth://totp/' + encodeURIComponent('KALIMAT Admin:' + email) +
      '?secret=' + secret + '&issuer=' + encodeURIComponent('KALIMAT Admin');
    return json({ secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) });
  }

  if (b.action === 'login') {
    const code = String(b.code || '');
    if (!/^\d{6}$/.test(code)) return json({ error: 'bad_code' }, 400);
    if (!t) return json({ error: 'invalid' }, 401);
    if (t.locked_until && new Date(t.locked_until) > new Date()) return json({ error: 'locked' }, 429);
    const step = await matchStep(t.secret, code);
    if (step === null || step <= Number(t.last_step)) {
      const fails = Number(t.fails) + 1;
      await admin.from('admin_totp').update({
        fails: fails >= MAX_FAILS ? 0 : fails,
        locked_until: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null,
      }).eq('email', email);
      return json({ error: fails >= MAX_FAILS ? 'locked' : 'invalid' }, fails >= MAX_FAILS ? 429 : 401);
    }
    if (!t.enrolled) {
      // First valid code proves the phone is set up: activate the admin and burn the setup key.
      await admin.from('shop_admins').upsert({ shop_id: t.shop_id, email });
      if (t.setup_key_hash) await admin.from('admin_setup').update({ used: true }).eq('key_hash', t.setup_key_hash);
    }
    // Atomic claim of this 30-second step: a code can be used once, even if two requests race.
    const { data: claimed } = await admin.from('admin_totp')
      .update({ enrolled: true, fails: 0, locked_until: null, last_step: step })
      .eq('email', email).lt('last_step', step).select('email');
    if (!claimed?.length) return json({ error: 'invalid' }, 401);
    const { count } = await admin.from('shop_admins').select('email', { count: 'exact', head: true }).eq('email', email);
    if (!count) return json({ error: 'not_admin' }, 403);
    const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !l?.properties?.hashed_token) return json({ error: 'session_failed' }, 500);
    return json({ token_hash: l.properties.hashed_token, email });
  }
  return json({ error: 'unknown_action' }, 400);
});
