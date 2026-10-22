# Migration verification status

Date: 2026-10-21 Pacific. **Standby deployment; isolated account acceptance passed, production cutover pending.**

Current takeover instructions: [Hudi/Codex handoff](fairwind-render-handoff.md).

## Passed

- Existing hosted frontend build: VITE_HOSTED=1 npm run build, exit 0.
  This initial local build had no production frontend environment; it verifies
  compilation only, not database connectivity or sign-in.
- Migration adapter and Calendar tests: 16/16.
- Actual start-render entry on local port 18789: GET /health -> 200 with
  businessReady=false; / and /me -> 503. Process stopped after verification.
- Private source branch pushed: hudi-la/producer-agent, codex/render-migration.
  Existing main branch and DigitalOcean application were not modified.
- Old server source fingerprint matches the migration snapshot for server.js,
  Calendar service and both lockfiles.

## Full legacy suite and repaired regression checks

After dependency installation completed, with Node 24.18.0 and
--experimental-test-module-mocks: **790 passed / 802 total; 12 failed**.

- 10 prompt tests compare against old frozen text or expected language/text.
- 1 Gmail error test expects old error output.
- 1 frontend artifact test mocks backends.js without the `supa` export required
  by its imports.

The original 12 failures have now been investigated. Ten prompt expectations
predated the separation of email/history/drafts and the updated persona. Tests
now preserve the independent legacy static-prefix comparison and check the new
source-separated context invariants. Four dedicated context-history tests cover
mail evidence, chronology, missing evidence and untrusted external instructions.
The Gmail test now asserts the intentional missing-scope message and preservation
of the original provider error as `cause`. The artifacts mock now supplies the
imported Supabase client; a regression checks discard/restore RPC arguments.
These are test repairs, not twelve production behavior fixes.

The local Node 24.18.0 runner additionally hit a child-process serialization error
in the callback test file. The same complete suite on the old production runtime,
Node 24.9.0, passed **823/823**. After adding two migration acceptance guard tests,
the final run passed **825/825**, with no skipped tests (16.14 seconds).
Command: `FAIRWIND_LANG=zh npm exec --yes --package=node@24.9.0 -- node
--experimental-test-module-mocks --test` followed by the globs in package.json.
Final log: `/tmp/fairwind-migration-final-tests.log` (local, not committed).
Passing fixture tests is not authenticated production acceptance.
Raw local log: /tmp/fairwind-migration-complete-tests.log (not committed).

Earlier exploratory runs occurred during interrupted/incomplete dependency
installation and/or without the module-mocking flag. They are superseded by the
802-test completed run and are not acceptance evidence.

## Render provisioning

- Owner approved securely importing existing Supabase server and Gmail OAuth
  client credentials into the new service in the parallight workspace.
- Created `fairwind-migration` (`srv-dbcpchavcj2c73fe55dg`), Oregon, 1 CPU / 2 GB,
  one instance, 1 GB disk at `/var/data/fairwind`, auto-deploy disabled.
- Credentials imported via a mode-0600 file outside Git. Server secrets are not
  VITE variables. Standby enforced via FAIRWIND_DEPLOYMENT_STATE=standby;
  FAIRWIND_CUTOVER_CONFIRMED=false.
- First deploy failed because NODE_ENV=production omitted Vite devDependencies.
  Fixed build command to use `npm ci --include=dev` for the frontend.
- Second deploy found `src/data/schema.js` was incorrectly excluded by the
  generic data-directory ignore rule. Added a narrow exception for this source
  file only (no tenant data). Clean `git archive HEAD` snapshot at `631b7e4`,
  fresh production-mode dependency install and VITE_HOSTED=1 build all passed.
- Third deployment uses `631b7e4`; adapter tests rerun: 5/5 passed.
- Render deployment `dep-dbcpe06i0phs73fjlj80` succeeded at 21:55 Pacific.
  Runtime log: `Fairwind migration standby; business workers disabled`.
- Public HTTPS assertions: 4/4 passed. GET /health returns 200;
  /, /me and /index.html return 503. All return deployment=standby and
  businessReady=false. These deliberate 503s are isolation, not app failure.
- Render Disk page verified 1 GB mounted at /var/data/fairwind.
- Existing https://fairwind.hudiworks.com/ still returned HTTP 200; no DNS or
  old service changes made. No private configuration exposed in these probes.
- Deploy screenshot: /tmp/fairwind-render-standby-deployed.jpg (local only).
- Dashboard: https://dashboard.render.com/web/srv-dbcpchavcj2c73fe55dg
- Candidate: https://fairwind-migration.onrender.com

## Runtime compatibility and real backend checks

- Render's native runtime SSH shell reported Node 24.22.1, unlike the old
  production Node 24.9.0, and had no `expect` binary for Claude subscription login.
  Switched the same paid candidate service to a Docker image pinning Node 24.9.0
  and installing Debian's `expect`; compute and disk plans are unchanged.
- The backend imports shared `src/lib` modules. Docker includes these and checks
  the real imports during build, not just the compiled frontend.
- Candidate commit `7bf8769`, deploy `dep-dbcpsitk3hvs739q6450`, is live in
  **standby**. SSH verified Node 24.9.0, expect 5.45.4, UID 1000 (non-root),
  persistent disk access and shared source modules.
- Added an operator-only acceptance mode: hosted, loopback bind, explicit owner
  allowlist, audited GET routes only, no browser assets/OAuth callbacks/MCP,
  no scheduled mail/scout/model workers. Existing tenant JWT authentication stays
  required. `/me` does not localize/write the seed task in this mode.
- Real secondary backend process on Render: **11/11 HTTP assertions passed**;
  unauthenticated and invalid-token access rejected; business POSTs, callbacks
  and UI blocked. Waited beyond initial 0/5/8-second scheduling deadlines and
  confirmed no background loops scheduled. Actual expect PTY probe passed.
  Script: `scripts/acceptance-smoke.mjs`. Model calls: 0.
- On the actual Linux Render instance, the focused prompt/context, Gmail callback,
  Claude-auth, Calendar, tenant isolation and deployment checks passed **77/77**
  with Node 24.9.0 (3.08 seconds). These use fixtures, not real Google writes.
- Public candidate `/health` is 200 with businessReady=false; `/` is deliberately
  503. These public responses verify standby isolation, not business readiness.
- Compared 483 original source files against the live DO installation: no
  differences at that earlier check. A later comparison found new usage-metering
  changes in four files plus dependencies on new modules. That later finding
  supersedes source parity; reconcile before cutover (see handoff).

## Durable state preparation

The live process uses `/var/lib/fairwind`, not `brain/users`. Initial private
backup: 310 files, 185,256,131 bytes. The archive is about 26 MiB, stored with
mode 0600 outside Git. Extracted-state aggregate SHA-256:
`fb017ce488c7449f8997efe9fde44bb0b9d88dc8a8f7ec0e048d18bd6fcd8209`.
Archive SHA-256:
`f6fa35d491c97773db3a39c8553e36d026571be2b152d939a8e948e8522e2b2a`.

SCP/rsync transfers were interrupted; partial destination files must not count
as successful migration. The fallback transfers hashed chunks over verified SSH
and checks the complete archive before it may be extracted for acceptance.
This is an initial online copy only. Final cutover still requires draining the
old service and a fresh consistent snapshot, including SQLite state/WAL files.

## Completed persistence and isolated account acceptance

- Verified archive `/var/data/fairwind/verified-state-f6fa35d491c97773.tar.gz`
  (26,812,155 bytes) against the SHA-256 above. Extracted into
  `/var/data/fairwind/acceptance-initial-20261021`, 310 files / 185,256,131 bytes.
  An actual Render restart preserved the same aggregate state hash.
- IMPORTANT: `/var/data/fairwind/users` at the disk root is still a partial copy
  from an interrupted earlier transfer. Do not activate live against that root
  until final verified state is installed. The isolated acceptance copy is valid.
- Explicitly authorized existing Di Hu account: 13 read-only checks passed;
  account-scoped Supabase views returned profile=1, pursuits=137, contacts=262,
  entries=61. Authenticated GET /me, /settings, /modules, /calendar/status and
  /judgments/files succeeded. Gmail token refresh/profile/message-list and
  Calendar token refresh/calendar-list succeeded without external writes.
- `scripts/acceptance-account.mjs --model` added one Claude SDK subprocess probe:
  14 checks passed, returned MIGRATION_OK, tools disabled, reported cost
  US$0.001539 (approved ceiling US$1). This is not full frontend/model-streaming
  acceptance. Test auth session signed out; secondary backend stopped.
- No mail sent or Calendar event created/modified. Public candidate remains
  standby and business workers remain disabled.
- Temporary Render SSH key `fairwind-migration-temporary-20261021` removed at
  handoff; dashboard showed No authorized SSH keys. Active migration SSH closed.

## Still required before cutover

- Reconcile later live usage-metering changes and new files, then rerun tests.
- Drain/stop only old Fairwind and transfer a fresh consistent final snapshot.
- Hudi must supply authorized access to hudiworks.com DNS. Render custom domain
  is registered but unverified; current Marvin Cloudflare account lacks the zone.
- Formal-host browser login, TLS, model streaming and live-worker verification.
  Old and new workers must never run together. No production DNS/service change
  has been made; DigitalOcean remains untouched.

Render dashboard confirms 2 GB compute $25/month and disk $0.25/GB/month.
Selected candidate: 1 GB disk, total base $25.25/month; user approved $26/month.
The paid candidate service has now been created within the approved budget.

DigitalOcean dependencies and conditional cleanup list are in
`docs/digitalocean-retention-inventory.md`. No DigitalOcean resources were deleted.
