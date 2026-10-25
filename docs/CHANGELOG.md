# Changelog
## Final candidate — engineering/integrity-and-regressions
- customers: accounts by username + phone, same orders/requests on every device, working logout, account created at checkout (BUG-013/014); migration 005 applied to production
- hero: floating circles/globe/stars removed, 10 backgrounds kept (BUG-016); slogan and the three claims kept by owner decision
- messages no longer cut short (BUG-015); service worker v10

## Earlier in this branch
- data layer: confirmed writes, loud failures with rollback, verified deletes, paged loads (BUG-001…005)
- admin: saves wait for the database; categories/sub-categories stored in the database with one-time migration of browser copies; hardcoded default categories removed; logo/favicon Reset removed; report days use the shop time zone (BUG-006…008)
- storefront: saved brand wins from first paint; default slogan removed; product image viewer (BUG-009…011)
- database: migration 003 applied to production (BUG-012)
- tests: unit + browser regression suites; docs/ added; Netlify no longer serves tests/docs; service worker v9
