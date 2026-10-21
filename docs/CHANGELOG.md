# Changelog
## Unreleased — engineering/integrity-and-regressions
- data layer: confirmed writes, loud failures with rollback, verified deletes, paged loads (BUG-001…005)
- admin: saves wait for the database; categories/sub-categories stored in the database with one-time migration of browser copies; hardcoded default categories removed; logo/favicon Reset removed; report days use the shop time zone (BUG-006…008)
- storefront: saved brand wins from first paint; default slogan removed; product image viewer (BUG-009…011)
- database: migration 003 applied to production (BUG-012)
- tests: unit + browser regression suites; docs/ added; Netlify no longer serves tests/docs; service worker v9
