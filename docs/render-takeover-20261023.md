# Render takeover — 2026-10-23 Pacific

Status: reconciled candidate, not deployed or cut over.

Reconciled from fresh read-only DigitalOcean source at /home/fairwind/producer-agent.
The existing local checkout and its uncommitted changes were preserved.
Source fingerprints: render-source-baseline-20261023.json (344 source files).

Included production usage counters/settings UI and today's sent-mail classification,
provider evidence checks, retry behavior and unsent-mail retraction integration.
The already-applied database RPC source is included for traceability; do not replay
or restore the shared Supabase database as part of host migration.
Retained migration acceptance guards, explicit identity isolation, read-only route
behavior and disabled background workers. Preserved migration test repairs.

The clean checkout exposed an omitted packaging/data/mcp-bridge.cjs (ignored by a
broad data/ rule); restored this source with a narrow ignore exception. UsageCard
now uses the project's translation dictionary with the same bilingual wording.

Validation on Node 24.9.0: full npm test file globs, 844 passed, zero failures or
skips. Hosted Vite build passed locally without production frontend env; this
proves compilation only. No real model calls, Google writes, or user-data changes.
Lockfiles/dependencies unchanged; npm reports existing dependency vulnerabilities
(4 root, 10 backend), not addressed by this migration.

Render dashboard initially confirmed parallight access, service
srv-dbcpchavcj2c73fe55dg, deployed commit 7bf8769 and deployment
dep-dbcpsitk3hvs739q6450. No deployment triggered. Browser control subsequently
lost page access; both Render and Cloudflare rendered blank. DNS permissions not
yet verified. Old fairwind.service checked active; not stopped or restarted.

Remaining: restore dashboard access; verify auto-deploy remains off and standby;
deploy this candidate manually; run container smoke/account acceptance; establish
secure state transfer access; verify DNS records/TLS requirements and rollback;
drain/stop only old Fairwind, transfer/hash/check final state including SQLite;
install verified state without using partial root users directory; activate only
Render, switch/verify formal domain, authentication, streaming and background jobs.
Keep DigitalOcean and all unrelated services. See fairwind-render-handoff.md for
full cutover and rollback sequence. No production change or final snapshot yet.
