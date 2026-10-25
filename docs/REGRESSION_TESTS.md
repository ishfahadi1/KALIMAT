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
| `t_slogan_kept_and_headline_override` | slogan stays by default, headline overrides |
| `t_hero_has_no_floating_shapes_but_keeps_backgrounds` | no shapes/animation; 10 backgrounds work |
| `t_account_follows_customer_across_devices` | username+phone brings the same orders/requests on another device; quote can be accepted |
| `t_wrong_details_cannot_sign_in_and_phone_locks` | wrong details refused; lockout |
| `t_logout_really_logs_out` | logout works and survives refresh |
| `t_checkout_save_details_creates_account_and_username` | account created before order; username shown |
| `t_guest_request_does_not_create_an_account` | guests can request without becoming logins |

Last run: unit 17/17, browser 14/14 (this branch). Database functions of migration 005 were also tested on the live database (19 checks, rolled back); the SQL is not covered by the repo's automated tests — rerun that script after any change to it.
