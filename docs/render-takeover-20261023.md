# Render takeover — 2026-10-23 Pacific

Status: production cut over to Render. Server-side acceptance passed; final browser/model acceptance remains pending. Earlier sections below are a historical preparation log.

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

## Production cutover result

User approved the temporary SSH key on 2026-10-23. Its fingerprint matched the
local key and Render's Oregon host fingerprint matched official documentation.
Actual container Node 24.9.0, commit 717b0a6, standby/false confirmed. Fresh 11/11
isolation checks and 13/13 Di Hu read-only account checks passed. Source comparison
of 344 live files was repeated twice with zero changed or new source candidates.

The first maintenance attempt was rolled back safely: direct Render SSH/SFTP and
rsync repeatedly reset. The old service resumed and public homepage/health were
verified. DNS remained unchanged and Render never ran business workers then.
ProxyJump via the already-authorized DO connection completed a full validated
25 MB SFTP transfer without copying the private key. The operator extraction
script was adjusted for Python 3.11.2, which lacks tarfile.extractall(filter=...).
It validates every archive member as an ordinary file/directory, rejects absolute
paths and parent traversal, and extracts explicitly without restoring ownership.

Second maintenance began 2026-10-23 23:45:52 UTC. Only Fairwind's Caddy host block
changed to a 503 maintenance response; the shared proxy and other sites stayed
running. After connections and child model processes drained, fairwind.service
was stopped. Its process/control group and listener were confirmed absent.
Service-role direct tasks-view counting was denied by existing database grants;
permissions were not expanded. Drain used host connection/child-process checks.

Final snapshot at 23:46:02 UTC:
- 345 files, 185,712,226 bytes; all 25 SQLite databases passed integrity_check.
- Archive bytes 25,658,226; SHA-256 a3dbd03b6428ad23c9fb6c713b0c67aa6daabd891cb6eeadf938f6056dcffe24.
- Manifest SHA-256 5822f900f18d35609d2df3eabeb9c4e2467af3b587066ff5328b9b8f717c726f.
- Source file manifest stayed identical after archiving; archive and manifest
  hashes matched on local download and Render. Extracted and installed file
  manifests matched; SQLite was checked again on Render. WAL/SHM were included.
- Source rollback bundle /home/fairwind/releases/render-cutover-20261023b/.
- Render bundle /var/data/fairwind/cutover-20261023b/; earlier partial root users
  moved to /var/data/fairwind/quarantine-pre-cutover-20261023b/ before install.
- Supabase was neither restored nor migrated to a different project.

Cloudflare's one Fairwind A record became DNS-only CNAME to
fairwind-migration.onrender.com. Other domain, mail, and application records were
untouched. Render domain verified and certificate issued. Public TLS validation
succeeded against Render IP 216.24.57.18. The old DNS record remains in local
rollback notes and docs/deployment.md.

Environment update deployment dep-dbdv43l9fdbs738paj0g remained standby because
masked inputs did not persist the intended values. Values were revealed (only
the two non-secret switches), edited, blurred, and verified before saving again.
Actual production deployment dep-dbdv4sfb9u1s73bkm22g uses the already-built commit
717b0a6beb28d00114f56f1ea498f9105cd2a1c5. Runtime explicitly reports live/true;
production worker startup logged 2026-10-23 23:49:23 UTC. Auto-deploy stays Off.
Old fairwind.service is inactive, MainPID=0, disabled to prevent reboot overlap.
Unrelated ERP containers remained up; DO and other services were not removed.

Post-cutover public authenticated checks for Di Hu all passed: /health, /me,
/settings, /settings/usage?days=7, /modules, /calendar/status, /judgments/files.
Identity matched the unique authorized account. Real Gmail profile/message list
and Calendar list passed using transferred state. Temporary test login sessions
were revoked locally. No test emails, calendar writes, or model calls occurred.
Public homepage and backend return 200. An initial transition 502 resolved after
the deployment became ready. Runtime memory measured approximately 183–210 MiB;
OOM counters zero. Logs show mail, opportunity-reading, and task timers started.
Only agent-created duplicate transfer/extraction validation files were removed;
verified archives, original acceptance material, and quarantined state remain.

Chrome displayed ERR_BLOCKED_BY_CLIENT on the formal domain. No browser safety
setting was disabled or bypassed. User was asked to open the site manually; final
browser login/data display and full model streaming acceptance remain pending.
An async request for a Di Hu model probe capped at $0.50 has not been answered;
no extra paid probe was run. These pending checks must not be reported as passed.

Rollback: first stop Render business by standby/false and verify it; compare and
back-transfer any newly written local state. Only then restore old DNS/proxy and
enable/start old fairwind.service. Shared Supabase remains current. The original
Caddy config and operator rollback script are in the DO bundle above. The retained
old host must not be deleted as part of this migration.

Final cleanup: disk use 505 MiB / 974 MiB, 454 MiB available. Temporary public key
fairwind-migration-hudi-20261023 was revoked in Render; the account visibly shows
No authorized SSH keys. No persistent CLI/API token was created. Final public
homepage and health returned 200, TLS verify=0, and DNS CNAME remained correct.
The deploy dashboard confirms dep-dbdv4sfb9u1s73bkm22g succeeded, triggered
2026-10-23 16:49:05 PDT. Original code commit was already pushed; this report is a
documentation-only follow-up and does not change the manually deployed image.
