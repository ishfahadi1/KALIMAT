# KALIMAT engineering baseline
Status as of branch `engineering/integrity-and-regressions` (based on `optimize-split-pwa` @ 900f68c).
**Evidence levels:** S = syntax/build check · U = unit test · B = browser test (real Chromium, real app code, *faked* Supabase/Cloudinary) · D = verified on the live Supabase database · L = live site / real devices.
No L-level verification has been done: the deployed site and real phones were not reachable from the engineering sandbox.

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Admin sign-in (authenticator, lockout, replay guard) | VERIFIED WORKING | B, D | `kal-admin` function; 1 admin enrolled in production. |
| Storefront render from database, cost price hidden | VERIFIED WORKING | B, D | `public_products()` strips cost fields. |
| Shopper order + product reservation | VERIFIED WORKING | B, D | Reservation now requires a real pending order (migration 003, applied to production). |
| Data-layer saves (confirm / rollback / paging) | FIXED, VERIFIED | U, B | BUG-001…005. |
| Categories & sub-categories persistence | FIXED, VERIFIED | B | BUG-007. Was browser-only. |
| Catalog: products create/edit/delete via admin UI | WORKING WITH LIMITATIONS | U (data layer), B (checkout) | Product *form* UI (image upload/replace, edit) not driven by a browser test yet. |
| Branding startup (no old scheme first) | FIXED, VERIFIED | B | BUG-009. Old code painted `#d946ef` in 69 frames. |
| Brand reset button | REMOVED, VERIFIED | B | BUG-008 (logo+favicon "Reset"). Theme presets/palette remain as normal editing controls. |
| Default slogan "Shop Smarter, Live Better" | KEPT BY OWNER DECISION | B | Static branding; a configured headline replaces it. |
| Product image full view | IMPLEMENTED, VERIFIED | B | BUG-011. Portrait/landscape/square, phone + desktop. |
| Reports date boundaries | FIXED, VERIFIED | U | BUG-006 (Kigali days). "One row" defect: NOT REPRODUCED (see registry). |
| Reports vs real data (each report documented) | NOT VERIFIED | — | Only date logic tested. See OPEN-006. |
| PWA install (storefront/admin) | WORKING WITH LIMITATIONS | S, review | `pwa.js` has native prompt + per-platform manual steps. Not tested on real iOS/Android. |
| Push notifications | NOT VERIFIED | D (trigger exists, webhook 200s) | No subscriptions exist yet. |
| Customer login / logout / profile (username + phone) | VERIFIED WORKING | B, D | BUG-013/014. Known limits listed in the registry. |
| Developer role + two-finger gesture + authenticator | NOT IMPLEMENTED | — | OPEN-002. |
| Hero backgrounds | VERIFIED WORKING | B | 10 CSS-built options, selectable in Branding; floating shapes removed (BUG-016). |
| Tutorial video upload | BROKEN (device-local) | code review | OPEN-003. |

## Must not regress
Reservation-after-order ordering (`kdb.rpc` queue) · cost price never reaches shoppers · admin session gate · category persistence · saved brand wins at first paint · no default slogan · image viewer.
