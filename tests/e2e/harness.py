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
        self.rows = {('config', '_'): cfg}; self.attempts = {}; self.log = []; self.config_delay = config_delay; self.fail_writes = fail_writes
        for i, (n, cat, imgs) in enumerate((('Woven Basket', 'Home', ['portrait.png', 'square.png']), ('Kitenge Bag', 'Fashion', ['landscape.png']))):
            self.rows[('products', f'p{i+1}')] = {"id": f'p{i+1}', "name": n, "price": 9000 + i * 6000, "category": cat, "images": ["https://res.cloudinary.com/xezz9csp/image/upload/v1/" + x for x in imgs], "stock": 1, "sale": "available", "status": "active", "featured": True, "costPrice": 4000, "shopId": "kalimat"}
    # ---- customer accounts (mirror of migration 005) ----
    @staticmethod
    def ph9(p): return ''.join(ch for ch in str(p or '') if ch.isdigit())[-9:]
    def cust_ids(self, user, phone):
        u = (user or '').strip().lower(); ph = self.ph9(phone)
        if not u or len(ph) != 9: return []
        return [i for (c, i), d in self.rows.items() if c == 'customers' and (d.get('username') or '').strip().lower() == u and self.ph9(d.get('phone')) == ph]
    def cust_auth(self, user, phone):
        ph = self.ph9(phone); a = self.attempts.get(ph, {'fails': 0, 'lock': 0})
        if len(ph) != 9: return []
        if a['lock'] > time.time(): raise Exception('locked')
        ids = self.cust_ids(user, phone)
        if not ids:
            f = 1 if (a['lock'] and a['lock'] <= time.time()) else a['fails'] + 1
            self.attempts[ph] = {'fails': f, 'lock': time.time() + 900 if f >= 8 else 0}; return []
        self.attempts.pop(ph, None); return ids
    def cust_json(self, cid):
        d = self.rows[('customers', cid)]; return {'id': cid, 'name': d.get('name'), 'username': d.get('username'), 'phone': d.get('phone'), 'email': d.get('email', ''), 'address': ((d.get('addresses') or [{}])[0]).get('line', '')}
    def customer_rpc(self, fn, a):
        import re as _re, uuid
        if fn == 'customer_login':
            ids = self.cust_auth(a['p_username'], a['p_phone']); return {'error': 'not_found'} if not ids else {'customer': self.cust_json(ids[0])}
        if fn == 'customer_register':
            un = a['p_username'].strip().lower()
            if not _re.match(r'^[a-z0-9._-]{3,24}$', un): raise Exception('bad_username')
            if len(self.ph9(a['p_phone'])) != 9: raise Exception('bad_phone')
            ids = self.cust_auth(un, a['p_phone'])
            if ids: return {'customer': self.cust_json(ids[0]), 'existed': True}
            cid = 'c_' + uuid.uuid4().hex[:12]
            self.rows[('customers', cid)] = {'id': cid, 'shopId': a['p_shop'], 'name': a['p_name'].strip(), 'username': un, 'email': a.get('p_email', ''), 'phone': a['p_phone'].strip(), 'contact': a['p_phone'].strip(), 'addresses': [{'id': 'a_' + cid[2:], 'label': 'Home', 'line': a.get('p_address', ''), 'city': ''}] if a.get('p_address') else [], 'joinedAt': '2026-10-20T00:00:00Z'}
            self.log.append(('account', un)); return {'customer': self.cust_json(cid), 'existed': False}
        if fn == 'customer_guest':
            ph = self.ph9(a['p_phone'])
            for (c, i), d in self.rows.items():
                if c == 'customers' and not d.get('username') and self.ph9(d.get('phone')) == ph: return i
            cid = 'c_' + uuid.uuid4().hex[:12]; self.rows[('customers', cid)] = {'id': cid, 'name': a['p_name'], 'phone': a['p_phone'], 'addresses': []}; self.log.append(('guest', cid)); return cid
        ids = self.cust_auth(a['p_username'], a['p_phone'])
        if not ids: raise Exception('denied')
        if fn == 'customer_activity':
            mine = lambda c: [{k: v for k, v in d.items() if k not in ('adminNotes', 'assignedTo')} for (cc, i), d in self.rows.items() if cc == c and d.get('customerId') in ids]
            return {'customer': self.cust_json(ids[0]), 'orders': mine('orders'), 'demands': mine('customerDemands')}
        if fn == 'customer_save':
            d = self.rows[('customers', ids[0])]; d.update(name=a['p_name'], email=a.get('p_email', '')); d['addresses'] = [{'id': 'a1', 'label': 'Home', 'line': a.get('p_address', ''), 'city': ''}]; return self.cust_json(ids[0])
        if fn == 'customer_answer_demand':
            for (c, i), d in self.rows.items():
                if c == 'customerDemands' and i == a['p_demand_id'] and d.get('customerId') in ids and d.get('status') == 'quoted': d['status'] = a['p_status']; return True
            return False
        raise Exception('unknown')
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
        if '/rpc/customer_' in u:
            try: return H(be.customer_rpc(u.split('/rpc/')[1].split('?')[0], json.loads(req.post_data)))
            except Exception as ex: return H({'message': str(ex)}, 400)
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
