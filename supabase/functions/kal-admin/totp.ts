const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function b32decode(s: string): Uint8Array {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += ALPHA.indexOf(c).toString(2).padStart(5, '0');
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export function b32encode(b: Uint8Array): string {
  let bits = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  let o = '';
  for (let i = 0; i < bits.length; i += 5) o += ALPHA[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return o;
}

// RFC 4226 HOTP with SHA-1, returns `digits` digits.
export async function hotp(key: Uint8Array, counter: number, digits = 6): Promise<string> {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 2 ** 32));
  dv.setUint32(4, counter >>> 0);
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', k, buf));
  const o = h[19] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

// Returns the matching 30-second step (for replay protection) or null.
export async function matchStep(secretB32: string, code: string, now = Date.now()): Promise<number | null> {
  const key = b32decode(secretB32);
  const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) if (await hotp(key, step + d) === code) return step + d;
  return null;
}

export async function sha256hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}
