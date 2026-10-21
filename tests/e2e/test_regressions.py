"""Browser regression tests (real Chromium, real app code, faked Supabase). Run: python3 tests/e2e/test_regressions.py  [ONLY=name]
Optional: KALIMAT_ROOT=/path/to/another/checkout runs the same tests against that tree (used to prove a test fails on old code)."""
import os, sys, json, traceback
sys.path.insert(0, os.path.dirname(__file__))
from harness import *
from playwright.sync_api import sync_playwright
BLUE = {'accent': '#1d4ed8', 'gradientFrom': '#2563eb', 'gradientTo': '#1e40af'}
SAMPLER = """window.__s=[];(function t(){var r=document.documentElement,b=document.body;if(r)window.__s.push([Math.round(performance.now()),getComputedStyle(r).getPropertyValue('--g1').trim().toLowerCase(),b?getComputedStyle(b).visibility:'none']);if(performance.now()<3500)requestAnimationFrame(t)})()"""
def ctx(br, **kw): return br.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', **kw)
def page(c, be, sampler=False):
    pg = c.new_page(); install(pg, be)
    if sampler: pg.add_init_script(SAMPLER)
    return pg
def text(pg): return pg.inner_text('body')

def t_brand_first_visit(br):
    """Saved brand is authoritative: a first-ever visit never paints an older/default scheme, then switches."""
    be = Backend(config_delay=1.2, theme=BLUE); pg = page(ctx(br), be, True); pg.goto(ORIGIN + '/'); pg.wait_for_timeout(3600)
    s = pg.evaluate('window.__s'); shown = [x for x in s if x[2] not in ('hidden', 'none') and x[1]]
    bad = [x for x in shown if x[1] != '#2563eb']
    assert not bad, f'{len(bad)} visible frames used a non-saved brand colour, first: {bad[0]}'
    assert s[-1][1] == '#2563eb' and s[-1][2] != 'hidden', f'final frame {s[-1]}'
def t_brand_returning_visit(br):
    """A returning visitor sees the saved brand from the very first frame."""
    be = Backend(config_delay=1.2, theme=BLUE); c = ctx(br); pg = page(c, be); pg.goto(ORIGIN + '/'); pg.wait_for_timeout(2500); pg.close()
    pg = page(c, be, True); pg.goto(ORIGIN + '/'); pg.wait_for_timeout(1800); s = pg.evaluate('window.__s'); vis = [x for x in s if x[2] not in ('hidden', 'none') and x[1]]
    assert vis and all(x[1] == '#2563eb' for x in vis), f'first visible frame: {vis[:1]}'
def t_no_default_slogan(br):
    """No built-in marketing slogan is ever shown; a configured headline is."""
    pg = page(ctx(br), Backend(headline=''), True); pg.goto(ORIGIN + '/'); pg.wait_for_timeout(1800); t = text(pg)
    assert 'Shop Smarter' not in t and 'Live Better' not in t, 'default slogan visible'
    be = Backend(headline='Fresh picks'); pg2 = page(ctx(br), be); pg2.goto(ORIGIN + '/'); pg2.wait_for_timeout(1800); assert 'Fresh picks' in text(pg2)
def t_no_brand_reset_button(br):
    """There is no Reset control on the Branding screen (it used to wipe the logo and favicon)."""
    assert 'children: "Reset"' not in open(os.path.join(ROOT, 'admin.html'), encoding='utf-8').read(), 'Reset button still in admin code'
    pg = page(ctx(br), Backend()); admin_login(pg); pg.get_by_text('Platform Management').first.click(); pg.wait_for_timeout(700)
    pg.get_by_role('button', name='Branding').first.click(); pg.wait_for_timeout(900)
    assert pg.get_by_role('button', name='Reset', exact=True).count() == 0, 'Reset button visible'
def _open_categories(pg):
    pg.get_by_text('Business Management').first.click(); pg.wait_for_timeout(500); pg.get_by_role('button', name='Categories').first.click(); pg.wait_for_timeout(800)
def t_category_saved_in_database_and_on_other_device(br):
    """A category created on one device is stored in the database and appears on another device."""
    be = Backend(); pg = page(ctx(br), be); admin_login(pg); _open_categories(pg)
    pg.get_by_placeholder('New category').fill('Kids clothes'); pg.get_by_role('button', name='Add category').click(); pg.wait_for_timeout(1200)
    saved = [c for c in be.coll('categories')]; assert saved and any(x.get('name') == 'Kids clothes' for x in (saved[0] if isinstance(saved[0], list) else saved)), f'not in database: {saved}'
    pg2 = page(ctx(br), be); admin_login(pg2); _open_categories(pg2); assert 'Kids clothes' in text(pg2), 'not visible on the second device'
def t_failed_category_save_is_not_reported_as_success(br):
    """If the database refuses the write the owner sees an error, never 'Category added', and nothing stays on screen."""
    be = Backend(fail_writes=1); pg = page(ctx(br), be); admin_login(pg); _open_categories(pg)
    pg.get_by_placeholder('New category').fill('Ghost'); pg.get_by_role('button', name='Add category').click(); pg.wait_for_timeout(1500); t = text(pg)
    assert 'Category added' not in t, 'false success shown'
    assert 'not saved' in t or 'server had a problem' in t, 'no error message shown'
    assert not be.coll('categories'), 'record should not exist'
    assert 'Ghost' not in t, 'unsaved category still on screen'

TESTS = [v for k, v in sorted(globals().items()) if k.startswith('t_')]
if __name__ == '__main__':
    only = os.environ.get('ONLY'); fails = 0
    with sync_playwright() as p:
        br = p.chromium.launch()
        for fn in TESTS:
            if only and only not in fn.__name__: continue
            try: fn(br); print('PASS', fn.__name__)
            except Exception as e: fails += 1; print('FAIL', fn.__name__, '-', str(e).splitlines()[0][:230])
        br.close()
    print(f'\n{len(TESTS) - fails if not only else "-"} passed, {fails} failed'); sys.exit(1 if fails else 0)
