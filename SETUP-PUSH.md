# KALIMAT: turn on notifications (3 steps, about 5 minutes)

## 1. Database (Supabase, project zjppqyktqhjoyfkhvpyh)
SQL Editor, New query, paste all of `supabase/migrations/004_push.sql`, Run. It is safe to run twice.

## 2. Edge function
Supabase dashboard, Edge Functions, Deploy a new function, Via Editor.
- Name: `kal-push`
- Paste all of `supabase/functions/kal-push/index.ts`
- Turn **Verify JWT OFF** (the function checks its own secret and the admin session)
- Deploy

(CLI instead: `supabase functions deploy kal-push --no-verify-jwt --project-ref zjppqyktqhjoyfkhvpyh`)
No keys to copy: the function creates its own push keys the first time it runs.

## 3. Publish the site
Upload this whole folder to Netlify as before. New or changed files: `assets/js/push.js`, `sw.js`, `admin.html`, `index.html`, `assets/js/kdb.js`.

## Test (do this before handing over)
1. On the owner's phone open `/admin`, sign in, tap **Turn on**, allow notifications.
   iPhone: Share, Add to Home Screen, open it from the new icon (iOS 16.4 or newer), then tap Turn on.
2. Close the app. On another device place a test order on the storefront. The phone should buzz within seconds and the icon should show 1.
3. Open the app: the order shows NEW in "What's happening" and the badge clears.

If nothing arrives, run in the SQL editor:
- `select role, count(*) from push_subscriptions group by role;` (admin should be 1 or more)
- `select status_code, content::text from net._http_response order by created desc limit 5;` (200 is good, 403 means the secret differs, 404 means the function is not deployed)

Also check Edge Functions, kal-push, Logs.

## What each person gets
- Owner/admin phone: new order, new customer. The icon badge counts what arrived while the app was closed.
- Shoppers who tapped "Yes, notify me": new product in stock. Several new products in a row collapse into one notification.
