# Contact mail excerpts and quiet draft styling

Production baseline verified in Render dashboard: 717b0a6beb28d00114f56f1ea498f9105cd2a1c5,
deployment dep-dbdv4sfb9u1s73bkm22g. Isolated checkout; existing work preserved.

Contact chat previously included kind=arrival notification snippets because their
Gmail ID is stored in metadata rather than the top-level column. These excerpts
were labeled Fairwind and looked like unfinished drafts. Exclude arrivals from
contact chat; retain original messages, draft artifacts and correspondence.
No database records are modified or deleted.

Draft cards use a subtle theme-relative gray-green tint, a uniform thin neutral
border, and neutral content/action separators instead of saturated green and a
thick left stripe. Both themes inherit their existing readable text colors.

Validation: 25 letter/artifact regression tests passed; hosted Vite build passed;
dark-mode browser preview verified. No emails sent or model calls made.
Gmail external-send reconciliation is not changed by this UI fix.

Deploy this document's code commit manually on the existing Render service.
Rollback to the previous production commit 717b0a6 via Render; no data rollback.

## Published

2026-10-23 19:17 PDT: manual Render deployment dep-dbe1a8hsrm7s73daja8g,
source 4120087b657ed0bfbc366aa91f191a4ea36f1d5f (pushed to GitHub
codex/quiet-drafts-20261023). Render reports Deploy succeeded / Live.
Public HTML loads index-DWdo0U18.js and index-BP9mc1Ot.css from this build.
Authenticated production browser confirms the truncated arrival is absent from
contact chat, original draft remains, and sent correspondence is still visible.
Actual dark-theme document styling verified in the production page.
A brief 502 during container replacement resolved when deployment became Live.
