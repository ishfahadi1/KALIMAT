# Bug registry
Format: symptom → root cause (with evidence) → fix → tests.

## Fixed
**BUG-001 Admin writes silently dropped (P1).** `kdb.push()` returned early when no admin session existed (expired/refresh failed) — no request, no error — while the cache already showed the record. *Evidence:* unit test failed on old code. *Fix:* admin writes now reject "Please sign in again". `assets/js/kdb.js`. *Test:* `kdb.test.js` BUG-001/001b.
**BUG-002 "Saved" shown before the database confirmed.** `wr()` returned `undefined`; admin `save/remove` returned immediately. *Fix:* `wr()` returns a promise that resolves only after the backend confirmed; admin services await it. `kdb.js`, `admin.html` (services layer). *Test:* BUG-002.
**BUG-003 Failed saves invisible and left phantom records.** Errors went to `window.toast`, which does not exist in the admin; the unsaved item stayed on screen. *Fix:* `KDB.onError` → admin `toast.error`; screen rolls back to server truth. *Test:* BUG-003 (unit), `t_failed_category_save_is_not_reported_as_success` (browser).
**BUG-004 Deletes that did nothing reported as success.** PostgREST returns 204 for a delete that removed 0 rows. *Fix:* delete uses `return=representation` and verifies. *Test:* BUG-004.
**BUG-005 Silent 1000-row cap.** Loads used `limit=1000`; the API caps at 1000 rows/request. *Latent:* production has 33 rows today. *Fix:* paged loads (records + `public_products`). *Test:* BUG-005/005b.
**BUG-006 Reports grouped orders by UTC day.** `inRange/today/rangeFromDays` used `toISOString().slice(0,10)`; an order at 01:30 Kigali time fell on the previous day. *Fix:* days computed in `config.js` `TIMEZONE` (Africa/Kigali). *Test:* `reports.test.js` (fails on 900f68c, passes now).
**BUG-007 Categories/sub-categories were browser-only (the "localStorage-like" symptom).** `CategoriesPage` wrote `window.localStorage` directly; production has zero `categories` rows. Also used a hardcoded default list and ignored database products. *Fix:* stored via the data layer; existing browser categories migrate once; hardcoded defaults removed; double-click guard. *Test:* `t_category_saved_in_database_and_on_other_device`.
**BUG-008 Logo/favicon "Reset" button.** One click wiped both. *Fix:* removed (palette/presets remain editable). *Test:* `t_no_brand_reset_button`.
**BUG-009 Old colours flash before the saved brand.** `store.css` + `CFG0` defaulted to magenta/violet and dark mode; `render()` ran before the config loaded. *Fix:* last real theme cached and applied in `<head>` before paint; first-ever visit is held until the config arrives (2.5 s failsafe); defaults can no longer overwrite a remembered/saved theme; fallback palette changed to the brand. *Test:* `t_brand_first_visit`, `t_brand_returning_visit` (old code: 69 magenta frames).
**BUG-010 Default slogan returned.** Hero fell back to "Shop Smarter / Live Better" when no headline was set; also static HTML, footer, meta, manifest, translation table. *Fix:* removed everywhere; hero hidden when empty. *Test:* `t_no_default_slogan`.
**BUG-011 Product images could only be seen cropped.** Cards use `object-fit: cover`; no viewer existed. *Fix:* viewer (contain-fit, tap-zoom, prev/next, Esc, close button, scroll lock, fallback). *Test:* `t_product_image_viewer_…`.
**BUG-012 Migration 003 not applied in production.** `reserve_product` let anyone mark any product sold. *Fix:* applied to the live database; verified attack paths return false and checkout still works (D).

## Open
**OPEN-001 Customer "login" is not authentication.** `saveUser`/`logout` set/remove a `localStorage` key; every profile save inserts another `customers` row (14 in production). Needs a trusted identity method. **Blocked on a business decision** (phone SMS-OTP vs email; needs an SMS/SMTP provider — Supabase's built-in email is heavily rate-limited).
**OPEN-002 Developer role, two-finger-hold entry, authenticator gate.** Not started. Plan: add a `developer` role to the existing `kal-admin` TOTP flow, enforce in RLS/function, run tests against an isolated `shop_id`.
**OPEN-003 Tutorial video is stored in the admin browser's IndexedDB** — customers on other devices never see it (a YouTube link works). Needs Cloudinary video upload.
**OPEN-004 Customer duplicates** (see OPEN-001).
**OPEN-005 Hero images.** The storefront hero uses CSS/SVG patterns chosen by `theme.heroBg` (`mist`, `blossom`, …). The 49 files in `assets/bg/` are the **admin photo-studio backgrounds**; no CSS references them. Please confirm which images you expect in the hero.
**OPEN-006 "One row" report defect not reproduced.** Production has 1 order and 1 expense. Date logic and paging bugs that could cause it are fixed; per-report data lineage still to document.
**OPEN-007 Install flows untested on real devices.**
**OPEN-008 Deployed site unverified.** Also confirm production runs the commit you deploy.
**OPEN-009 Hero "trust" cards** ("Secure Payments / Fast Delivery / 24/7 Support") are default claims; owner decision needed.
