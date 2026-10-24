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
