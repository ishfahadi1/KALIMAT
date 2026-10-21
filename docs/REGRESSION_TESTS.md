# Regression tests
Run before every release.
```
npm run check                      # syntax of all scripts
npm test                           # unit tests (Node 22, no dependencies)
pip install playwright && playwright install chromium
python3 tests/e2e/test_regressions.py          # browser tests (ONLY=name to filter)
KALIMAT_ROOT=/path/to/old/checkout python3 tests/e2e/test_regressions.py   # prove a test fails on old code
```
The browser tests run the **real** app in Chromium and fake only Supabase and Cloudinary (`tests/e2e/harness.py`, which mirrors the production RLS rules). They do **not** prove behaviour against the real backend or on real phones.

| Test | Protects |
|---|---|
| `kdb.test.js` BUG-001…005 | confirmed saves, loud failures, rollback, verified deletes, paging |
| `kdb.test.js` REGRESSION ×4 | shopper insert-only, admin edit/delete, Cloudinary upload, no cost price |
| `reports.test.js` | shop-time-zone days, inclusive ranges, all rows included |
| `t_brand_first_visit`, `t_brand_returning_visit` | saved brand authoritative from first paint |
| `t_no_default_slogan` | no built-in slogan; configured headline shows |
| `t_no_brand_reset_button` | Reset control absent |
| `t_category_saved_in_database_and_on_other_device` | categories persist and are shared |
| `t_failed_category_save_is_not_reported_as_success` | no false success |
| `t_product_image_viewer_…` | full, undistorted image; Esc/close/next |
| `t_shopper_checkout_places_order_and_reserves_product` | order stored **before** reservation |

Last run: unit 16/16, browser 8/8 (this branch). On commit 900f68c the new defect tests fail (unit: 7 of 11 data-layer, 2 of 5 report; browser: 6 of 6).
