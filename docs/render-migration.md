# Fairwind Render migration — 2026-10-21 (Pacific)

## Status and scope

This is an isolated snapshot of the current DigitalOcean source, not an older
local checkout. The original server and database have not been changed.
Target: one Render Node web service serving both frontend and backend, existing
Supabase project retained, one persistent disk. No schema migration is required.
User-approved incremental infrastructure budget: US$26/month total (revised after
checking Render's US$25/month 2 GB compute plan plus persistent disk). Provider
model usage is separate; do not introduce platform-funded model calls.

The default deployment is **standby**, not a working replacement. It exposes a
health check but blocks every business request. It never imports `server.js`,
connects to Supabase, runs a model, reads mail, or synchronizes Google Calendar.
The browser app is also withheld because it can write directly to Supabase.
An HTTP 200 from standby `/health` does **not** prove business readiness.

## Changes

- `scripts/render-runtime.mjs`: validates deployment mode, Render port, hosted
  configuration, durable path and explicit cutover acknowledgment; safe standby.
- `scripts/start-render.mjs`: Render-specific entry. Live mode requires a writable
  mounted disk and maps Render `PORT` to existing `BRAIN_PORT`; binds 0.0.0.0.
- `scripts/render-runtime.test.mjs`: configuration guards and real HTTP checks.
- `render.yaml`: manual-deploy single-instance service, Node 24, disk, no embedded
  credentials. Keep secrets in Render settings, never in source or screenshots.
- `.gitignore`: also excludes production env files, user state and diagnostic logs.

Original business modules and lockfiles are unchanged. Do not silently upgrade
dependencies or rewrite behavior just to make migration tests pass.

## Deployment checklist

1. Check final compute + disk price against US$26, including mandatory charges.
   Use 2 GB; 512 MB may be insufficient: observed DO process memory was
   about 161 MiB current / 405 MiB peak, before a worst-case model subprocess.
   Validate representative memory usage before production activation.
2. Create a **private** source repository, connect it to Render, deploy standby.
   Disable automatic deploy; one instance only. A disk-backed service has a
   deployment interruption; do not promise zero downtime.
3. Transfer only required server env secrets securely from `/etc/fairwind/env`.
   Frontend gets only existing public Supabase URL/anon key and VITE_HOSTED=1.
   Never put service_role, Gmail secret or model keys in VITE_*.
4. Resolve all persistent-state locations from the live process configuration.
   Calendar defaults to `brain/users/<owner>/calendar.json` if no data directory
   is set. Tenant Codex state is under its configured data directory. Record
   file counts/hashes, not credential contents. Back up and transfer state to
   `/var/data/fairwind`; restrictive permissions, no public download link.
5. Reconcile any source changes made on DO since the snapshot before cutover.
6. Validate with a dedicated test identity / isolated test database first.
   Existing Supabase and Google authorized redirects must match the selected
   host. Retaining `fairwind.hudiworks.com` avoids changing the public entrypoint.
   Do not add wildcard redirects or migrate all users to a new account.
7. Maintenance/cutover: drain requests and background jobs; stop **only**
   `fairwind.service`, not the shared DO host. Transfer the final state delta.
   Set FAIRWIND_CUTOVER_CONFIRMED=true and FAIRWIND_DEPLOYMENT_STATE=live on Render.
   This flag is an operator assertion, **not a distributed worker lock**.
   The old and new production workers must never run concurrently.
8. Verify authentication, owned data, MCP, model streaming (with an approved
   test account/budget), Gmail read/draft, Calendar state and restart persistence.
   Sending email or writing external calendar events requires an explicit test
   recipient/calendar; migration verification must not contact real recipients.
9. Switch the domain only after checks and final owner confirmation. Retain DO
   backup for rollback. Rollback stops Render first, syncs newer disk state back
   if necessary, then restores old routing and starts the old service. Supabase
   stays the same; never restore a stale database over new user writes.

## Local commands

```sh
npm ci
npm ci --prefix brain
node --test scripts/render-runtime.test.mjs brain/calendar/*.test.js
VITE_HOSTED=1 npm run build
PORT=10000 node scripts/start-render.mjs
# In another terminal: health is 200, business routes are 503.
curl http://localhost:10000/health
```

Full legacy test suite needs Node's module-mocking flag for tests using
`mock.module` (this flag is not accepted in NODE_OPTIONS):

```sh
FAIRWIND_LANG=zh node --experimental-test-module-mocks --test \
  'src/lib/*.test.js' 'src/i18n/*.test.js' 'brain/*.test.js' \
  'brain/engine/*.test.js' 'brain/mail/*.test.js' \
  'brain/local/*.test.js' 'brain/backup/*.test.js'
```
These tests use local fixtures; passing them does not verify real user accounts.

## Source fingerprint (before adaptation)

- brain/server.js: e0aabc65ac42da10f54de62306ebd3e950d11d4cc77b33d4da1ae8f69f300f1f
- brain/calendar/service.js: d2530dcb372505ec686a6e4b956433bba5873553dddaa8bc181e6a1045572515
- package-lock.json: 9a6605166c98e734157f946ccbdc97923802d6513a701cee6cca2473f90b86a8
- brain/package-lock.json: fb3ef62704b49c4b3cf0a4856b327337613c8d4b846f94c134c58f4871166b53

## References

- https://render.com/docs/compute-plans
- https://render.com/docs/disks
- https://render.com/docs/blueprint-spec
- https://supabase.com/docs/guides/auth/redirect-urls
