"""E2E harness: serves the repo as https://kalimat.test and fakes ONLY Supabase + Cloudinary (in memory), so real browsers run the real app.
Requires: pip install playwright && playwright install chromium.  The fake mirrors the RLS rules in supabase/migrations."""
import json, mimetypes, os, time
from urllib.parse import urlparse, parse_qs
ROOT = os.environ.get('KALIMAT_ROOT') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')); ORIGIN = 'https://kalimat.test'
CONFIG = json.load(open(os.path.join(os.path.dirname(__file__), 'fixtures', 'config.json')))
PUBLIC = {'config', 'categories', 'promotions', 'policies', 'businessProfile', 'tutorial'}
ADMIN_JWT = 'ADMINJWT'
import io
from PIL import Image
def _png(w, h):
    b = io.BytesIO(); Image.new('RGB', (w, h), (90, 160, 40)).save(b, 'PNG'); return b.getvalue()
SHAPES = {'portrait': _png(300, 600), 'landscape': _png(600, 300), 'square': _png(400, 400)}
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1b8ac1c0000000049454e44ae426082')
QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

class Backend:
    def __init__(self, config_delay=0.0, fail_writes=0, theme=None, headline=None):
        cfg = json.loads(json.dumps(CONFIG)); cfg['theme'].update(theme or {})
        if headline is not None: cfg['content']['headline'] = headline
        self.rows = {('config', '_'): cfg}; self.log = []; self.config_delay = config_delay; self.fail_writes = fail_writes
        for i, (n, cat, imgs) in enumerate((('Woven Basket', 'Home', ['portrait.png', 'square.png']), ('Kitenge Bag', 'Fashion', ['landscape.png']))):
            self.rows[('products', f'p{i+1}')] = {"id": f'p{i+1}', "name": n, "price": 9000 + i * 6000, "category": cat, "images": ["https://res.cloudinary.com/xezz9csp/image/upload/v1/" + x for x in imgs], "stock": 1, "sale": "available", "status": "active", "featured": True, "costPrice": 4000, "shopId": "kalimat"}
    def visible(self, admin): return [(c, i, d) for (c, i), d in self.rows.items() if admin or c in PUBLIC]
    def coll(self, c): return [d for (cc, i), d in self.rows.items() if cc == c]

def install(page, be):
    def sb(route, req):
        u = req.url; H = lambda b, s=200: route.fulfill(status=s, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(b))
        adm = ADMIN_JWT in req.headers.get('authorization', ''); q = parse_qs(urlparse(u).query)
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
        if '/functions/v1/kal-admin' in u:
            b = json.loads(req.post_data); a = b['action']
            if a == 'status': return H({"enrolled": False})
            if a == 'enroll': return H({"secret": "JBSWY3DPEHPK3PXP", "qr": QR}) if b.get('setup_key') == 'KEY-123' else H({"error": "bad_key"}, 403)
            if a == 'login': return H({"token_hash": "th", "email": b['email']}) if b['code'] == '123456' else H({"error": "invalid"}, 401)
        if '/auth/v1/verify' in u: return H({"access_token": ADMIN_JWT, "refresh_token": "r", "expires_in": 3600, "user": {"email": "owner@kalimat.co.rw"}})
        if '/rpc/public_products' in u: return H([{"id": i, "data": {k: v for k, v in d.items() if k != 'costPrice'}} for c, i, d in be.visible(False) if False] + [{"id": i, "data": {k: v for k, v in d.items() if k != 'costPrice'}} for (c, i), d in be.rows.items() if c == 'products'])
        if '/rpc/' in u: be.log.append(('rpc', u.split('/rpc/')[1].split('?')[0], req.post_data)); return H(True)
        if '/rest/v1/records' in u:
            if req.method == 'GET':
                if be.config_delay: time.sleep(be.config_delay)
                rows = be.visible(adm); fc, fi = q.get('coll', [None])[0], q.get('id', [None])[0]
                if fc: rows = [r for r in rows if r[0] == fc.replace('eq.', '')]
                if fi: rows = [r for r in rows if r[1] == fi.replace('eq.', '')]
                off = int(q.get('offset', ['0'])[0]); lim = min(int(q.get('limit', ['1000'])[0]), 1000)
                return H([{"coll": c, "id": i, "data": d} for c, i, d in rows][off:off + lim])
            if req.method == 'POST':
                if be.fail_writes > 0: be.fail_writes -= 1; return H({"message": "boom"}, 500)
                b = json.loads(req.post_data)
                if not adm and b['coll'] not in ('orders', 'customers', 'customerDemands'): return H({"code": "42501", "message": "rls"}, 401)
                be.rows[(b['coll'], b['id'])] = b['data']; be.log.append(('write', b['coll'], b['id']))
                return H([b], 201) if 'representation' in req.headers.get('prefer', '') else route.fulfill(status=201, headers={'access-control-allow-origin': '*'}, body='')
            if req.method == 'DELETE':
                i = q['id'][0].replace('eq.', ''); c = q['coll'][0].replace('eq.', ''); gone = be.rows.pop((c, i), None); be.log.append(('delete', c, i))
                return H([{"id": i}] if gone is not None else [])
        return H({})
    def local(route, req):
        u = req.url
        if u.startswith(ORIGIN):
            p = urlparse(u).path
            if p == '/admin' or p == '/admin/': p = '/admin.html'
            if p == '/': p = '/index.html'
            f = ROOT + p
            if os.path.isfile(f): return route.fulfill(status=200, content_type=mimetypes.guess_type(f)[0] or 'text/plain', body=open(f, 'rb').read())
            return route.fulfill(status=404, body='')
        if 'res.cloudinary.com' in u:
            for k, v in SHAPES.items():
                if k in u: return route.fulfill(status=200, content_type='image/png', body=v)
            return route.fulfill(status=200, content_type='image/png', body=PNG)
        if 'api.cloudinary.com' in u: return route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'secure_url': 'https://res.cloudinary.com/xezz9csp/image/upload/v1/up.png'}))
        if 'supabase.co' in u: return sb(route, req)
        return route.fulfill(status=200, content_type='text/css' if 'css' in u else 'text/plain', body='')
    page.route('**/*', lambda r: local(r, r.request))

def admin_login(page):
    page.goto(ORIGIN + '/admin'); page.wait_for_selector('input', timeout=20000); page.wait_for_timeout(1500)
    page.locator('input').first.fill('owner@kalimat.co.rw'); page.once('dialog', lambda d: d.accept('KEY-123'))
    page.get_by_role('button', name='Continue').click(); page.wait_for_timeout(1200)
    page.locator('input').last.fill('123456'); page.get_by_role('button', name='Confirm setup').click(); page.wait_for_timeout(2500)
