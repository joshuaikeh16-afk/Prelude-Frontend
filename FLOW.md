# Prelude V1 flow decisions

The production frontend is `prelude-html`; `frontend/` is a legacy prototype.

- First visit: required Plan → Live → Remember intro, remembered on this browser. Then sign in.
- Email/password and Google signup both require full name and preferred name. Email signup requires verified email. New accounts complete one required Home walkthrough, recorded on their account.
- Navigation: Home, Events, Create, Calendar; Profile opens from the header. Events toggles Upcoming/Past. Past events open Remember.
- Creation: Identity → Optional details (expandable goals/tasks/notes, optional map location/image/time/priority) → Review. Warn that name/date cannot change; account preference can suppress future warnings. Return to Home.
- One draft per account; Continue or Start new. Replacing it requires confirmation. Today/future dates only.
- Multiple goals containing tasks, plus standalone tasks. Every task contributes equally; goals summarize their tasks without double counting. A taskless goal remains incomplete. Deleting a goal deletes its tasks after confirmation.
- Tasks have no separate due date. Their deadline is the event start or 9 AM in its timezone. Task work and time edits lock then. An event created today after that deadline is editable until midnight instead. Notes, location and schedule remain editable until event completion.
- Optional digital task timers: manual completion, pause/resume, Stop preserves remaining time and releases the active slot. One active (running/paused) timer per account. Finish/stop it before starting another. Complete task stops its timer. Expiry leaves an unchecked task red; extend by 5/10/15 minutes or custom duration before the event deadline. Persistent in-app timer bar; background time is timestamp-based. Web push sends expiry, rather than promising an unsupported live system countdown.
- Manual event completion from the event day; warn about incomplete tasks and preserve their state. Auto-complete at midnight following the entire grace day: 24 hours after the event date ends. No reopening.
- Remember: preparation history read-only; editable photos/reflection. Repeat next year makes a new event with copied location, goals/tasks/notes/schedule, reset completion, shifted schedule dates, no memories. Review before creation. Feb 29 maps to Feb 28 in a non-leap year.
- Automatic reminders 24 hours before start and at start (9 AM if no time). Contextual opt-in after first creation; dismissible Home banner resets next visit. User-created reminders remain available.
- Calendar tap shows date/events/holidays; long press creates with date filled. Keyboard users have an equivalent Create-on-this-day button. Holiday country defaults to Nigeria, configurable in Settings.
- Location: provider-backed search/select; external directions with driving/walking/transit. No launch-time location permission.
- Multiple separately saved notes. Schedule items have title/date/time, before or on event day only.
- Cancelled events are deleted after confirmation. Premium restrained glass surfaces, transitions, reduced-motion support, accessible controls and truthful errors.

## Setup

Run the HTML directory with an HTTP server and the Next.js backend separately. `js/config.js` uses the current local hostname on port 3000 in development and the current origin in production; override `window.PreludeConfig.apiBase` there for a separately deployed API. No server secrets belong in that file.

Apply `backend/supabase/migrations/20261002_coherent_v1.sql` through Supabase SQL Editor before using the new event workflows. It targets the actual deployed schema inspected on 2 October 2026. Configure `PRELUDE_FRONTEND_ORIGINS` (comma-separated explicit origins), `RESEND_FROM`, `GEOAPIFY_API_KEY`, `CRON_SECRET`, and VAPID keys in the backend environment. Set the Supabase Google redirect allowlist to the HTML `signup.html` URL. The notification dispatch cron must run independently of an open browser.

Map search needs a Geoapify key. Holidays use Calendarific when `CALENDARIFIC_API_KEY` is configured; otherwise Nager.Date is queried and unsupported countries are reported honestly (no invented Nigerian holiday dates). Browser push needs HTTPS, device/browser support, a service worker and VAPID configuration. A ticking operating-system notification is not universally supported by web browsers; the in-app countdown and background expiry push are the supported web behavior.

## Run and verify

From the repository root, serve `prelude-html` with `python3 -m http.server 8080 --directory prelude-html`. In another terminal run `npm run dev` from `backend`. The frontend defaults to the existing Supabase project using its public anonymous key; RLS and verified authentication control access.

Before applying the new migration, take a normal Supabase database backup. This migration replaces policies on the Prelude tables to enforce ownership and adds authoritative preparation rules. It is designed for the inspected deployed schema; do not run the older `20260928_missing_v1.sql` against that schema because its goal, schedule and push column names differ. The new migration can be reapplied. No live migration has been executed from this workspace.

Also allow the deployed `reset-password.html` URL in Supabase Auth's redirect settings. Configure Google as an Auth provider if Google login is wanted. Configure a verified sender domain for Resend. Run `/api/notifications/dispatch` every minute with `Authorization: Bearer <CRON_SECRET>`; automatic completion is also synchronized on authenticated visits. Without an external scheduler, completion cannot happen while all clients are closed. The existing Vercel cron configuration is included; choose a hosting plan/scheduler that supports that frequency.

From `prelude-html`, run `npm ci`, then `npm test` for pure calculation tests and `npm run test:database` for isolated PostgreSQL behavior checks. To run `npm run test:browser`, first serve the HTML on port 8081. Browser checks use deterministic fixtures, never the live database, and require Chrome (`CHROME_PATH` can override its path). Set `PRELUDE_TEST_ORIGIN` to use a different local server origin. Run `npm run test:api` against a running backend to verify public configuration, authorization and CORS without creating accounts or sending messages. The database tests emulate the deployed base schema using PGlite; they do not certify existing live policies, third-party delivery, or production configuration.

`js/app-v1.js`, `js/views/`, `js/data.js`, `js/ui.js`, `js/timer.js`, `js/notifications.js`, and `css/prelude.css` are the active HTML application. Old scripts and styles remain as inactive references; the page entry points do not load them. `frontend/` remains untouched.
