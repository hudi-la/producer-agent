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

## Correction: retain notifications using the established mail card

The user wants to retain incoming/outgoing notices. Hiding arrivals was an
incorrect interpretation. Restore them in contact chat through a shared
MailNotice component extracted from the existing pursuit Letter renderer.
Resolve the arrival's exact linked mail ID (or Gmail ID) to show its sender,
full excerpt with an ellipsis, and expandable original. Never infer sending
from draft similarity. Missing linked originals retain a labeled excerpt.
Pursuit notification rows use the same renderer. Quiet draft styling remains.
26 regression tests and hosted build pass. No data writes or email sends.

Correction published 2026-10-23 20:30 PDT: commit
2b27093e78dc97ffe6893d4f35383117de88ab7b, Render deployment
dep-dbe2cl7avr4c739rnc80, succeeded / Live. Production health ok.
Authenticated contact page verified incoming “Kiko Thomas 来信” and outgoing
“你发出” cards; latest outgoing notice expands the complete original through
the closing signature and collapses correctly. No mail or database writes.
Rollback code to 4120087 only if necessary (that version hides notifications).
