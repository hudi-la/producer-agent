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

## Resumed dashboard access

Fresh Chrome tabs restored functional browser control. Cloudflare account visibly
contains hudiworks.com. Fairwind has one A record, 64.23.225.65, DNS only, TTL Auto;
no conflicting Fairwind AAAA/CNAME. Original record saved locally for rollback.
Render auto-deploy verified Off. Manually deployed exact commit
717b0a6beb28d00114f56f1ea498f9105cd2a1c5 at 2026-10-23 16:25:41 PDT;
deployment dep-dbdupt3ncjis73dj0dcg succeeded in 2m00s. Startup logs confirm
standby with business workers disabled. Public health confirms standby.

Render account has no SSH public keys. Generated a local temporary Ed25519 key
named fairwind-migration-hudi-20261023; public fingerprint
SHA256:Grilw2/JbZc61ZqQTlmtb62F+a9t65+4Q8ZhB6M1WvY. Addition awaits user's explicit
access confirmation; not registered yet. Private key remains outside repository.
No DNS change, old-service stop, final-state copy or production activation yet.
