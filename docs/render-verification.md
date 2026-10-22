# Migration verification status

Date: 2026-10-21 Pacific. **Standby deployment; not production acceptance.**

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

## Full legacy suite — NOT all green

After dependency installation completed, with Node 24.18.0 and
--experimental-test-module-mocks: **790 passed / 802 total; 12 failed**.

- 10 prompt tests compare against old frozen text or expected language/text.
- 1 Gmail error test expects old error output.
- 1 frontend artifact test mocks backends.js without the `supa` export required
  by its imports.

These source/test files are copied from the running server, not changed by the
migration adapter. Do not hide these failures or claim complete business
verification. Their exact causes and production relevance still need review.
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

## Awaiting

- Durable state inventory and transfer.
- Dedicated-account authenticated end-to-end checks and restart tests.
- Final maintenance/cutover plan and domain switch; old workers must stop before
  new live workers start. No production DNS/service changes made.

Render dashboard confirms 2 GB compute $25/month and disk $0.25/GB/month.
Selected candidate: 1 GB disk, total base $25.25/month; user approved $26/month.
The paid candidate service has now been created within the approved budget.
