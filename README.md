# BBCDM Christmas Eve Classic PWA

A mobile-first, installable progressive web app for the 2026 BBCDM Christmas Eve Classic at Clare Golf Club. Built with React, TypeScript, Vite and optional Supabase connectivity. Includes a 2020–2025 historical results archive and 26-player 2026 roster.

## What's included

- Home dashboard and event information
- 26-player field and 2020–2025 career records with placements, team members and scores
- Champion history, ties and pending-verification flags
- Random two-man draw, locking, group and starting-hole allocation, unpublished/public draw
- Handicap calculator (35% lower + 15% higher; committee rounding must be confirmed)
- 18-hole shotgun scorecard with gross strokes, penalties and six-drive tracking
- Provisional leaderboard, net calculation for completed rounds
- Supabase RLS for protected score writes, role permissions, score audit, and live updates
- Installable PWA manifest, home-screen icon and local score queue for offline submission

**Important:** This is a source project, not a deployed production app. Live multiuser use requires configuring Supabase and web hosting. Before the event, test on actual iPhone/Android devices in poor reception. Further work is needed for full player/marker verification, automatic countback, administrative historical edits and robust offline conflict resolution. Never use untested app output as the official tournament result.

## Run locally

1. Install Node.js 20+.
2. In this folder run `npm install`.
3. Run `npm run dev`.
4. Open the local address displayed. Without Supabase, the app runs in local **preview mode**. The draw and scoring work on that device only.

## Enable shared access

1. Create a Supabase project using its free tier.
2. In Supabase SQL Editor, run `supabase/schema.sql` followed by `supabase/seed.sql`.
3. Copy `.env.example` to `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase project settings. Never expose a service-role key in the browser.
4. In Supabase Authentication, enable Email OTP and configure an appropriate redirect URL for your deployed app.
5. Create your own user via the app's email sign-in. In the Supabase SQL Editor, get your user ID from `auth.users`, then grant a director role:

   ```sql
   insert into public.admin_users(user_id,role)
   select id,'director' from auth.users where email='YOUR_EMAIL_HERE';
   ```
6. Link player logins only after verifying their email or identity. After each player logs in, link their account:

   ```sql
   insert into public.player_accounts(user_id,player_name)
   select id,'Joshua Clarke' from auth.users where email='PLAYER_EMAIL_HERE';
   ```
7. For cross-marking, insert a marker assignment using the actual `pairs.id`:

   ```sql
   insert into public.marker_assignments(pair_id,marker_player)
   values ('PAIR_ID_HERE','NAME OF AUTHORISED MARKER');
   ```
8. Deploy to a free static hosting service (for example, Vercel or Netlify) with build command `npm run build` and output folder `dist`. Enter the same two `VITE_` environment variables in the hosting settings. Configure the deployed HTTPS address as an allowed Supabase auth redirect URL.
9. Distribute the HTTPS link to players. iPhone users open it in Safari and select Share → Add to Home Screen; Android users open it in Chrome and select Install app or Add to Home screen.

## Before Christmas Eve

- Confirm the course's official tee set, stroke indices, and distances. The app currently uses the supplied Clare white-tee scorecard (par 72).
- Approve whether the 35%/15% inputs are handicap index or course handicap, plus exact rounding.
- Review unresolved 2020 winning score, 2021 79-stroke placement tie, the two Jack Bruce references for 2024, and William Schultz's 2025 equal sixth.
- Confirm all 26 arrivals and actual attendance, then draw 13 pairs.
- Set actual groups, starting holes and assigned marker accounts. The original six-group plan means five groups of four and one group of six.
- Test all 18 holes, scoreboard refreshes, score edits, offline recovery, verification and final-countback rules.
- **Do not change the pair draw after scoring begins**, as changing pairs requires deleting previous scorecards.

## Known limits in this first version

- Local preview shows data only on the current browser/device.
- Supabase backend supports secure score editing while `events.status='live'`, but the application needs further role-specific UI controls for cross-marking and dual-scorecard confirmation.
- The browser caches scores in a local queue when a network save fails, then retries. This is not yet an audited, conflict-safe offline system.
- Historical archive is bundled as verified/pending seed data in the frontend. The `historical_results` SQL table provides storage for later editing workflows but the current frontend does not query or edit that table.
- Automatic net standings work for completed rounds, but official countback and finalisation need committee review/implementation.
- PWA install support is browser-dependent. For robust offline app-shell loading, add a service worker with cached static assets before launch.
- The seed contains all documented results but some entries are pending checks. Scores from tournaments with different formats are not directly comparable.
- Shared hosting and database are free only while provider free-tier terms and limits are satisfied.

Excluded intentionally: merchandise, membership packages, clothing orders, payment tracking and financial reconciliation.
