# Migration verification status

Date: 2026-10-21 Pacific. **Not production acceptance; no Render service created yet.**

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

## Awaiting

- User confirmation to transfer existing Supabase service-role and Gmail OAuth
  client credentials into the new Render service. Private import file prepared
  outside the repository; never print its contents or upload to GitHub.
- Render service creation/deploy, durable state inventory and transfer.
- Dedicated-account authenticated end-to-end checks and restart tests.
- Final maintenance/cutover plan and domain switch; old workers must stop before
  new live workers start. No production DNS/service changes made.

Render dashboard confirms 2 GB compute $25/month and disk $0.25/GB/month.
Selected candidate: 1 GB disk, total base $25.25/month; user approved $26/month.
No paid service has been created or charged by this task at this checkpoint.
