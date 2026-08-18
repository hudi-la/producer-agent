# Fairwind — a walkthrough in screenshots

An English set of the same 14 shots as [`../shots/`](../shots/), for showing people who want
to build something like this. Order = the order to tell it in: **where opportunities come
from → what happens inside a card → who presses send**.

> **How these were made.** The app is Chinese-only; nothing in it was changed. The screenshots
> were taken against the live app (`npm run dev` + `npm run brain`, real database) with a
> throw-away translation layer injected into the DOM in the browser at capture time. No code,
> no data, no strings in the repo were touched — reload the page and it is Chinese again.
> That also means **the English here is a caption, not a build**: it exists in these PNGs only.

| # | Shot | The one line it makes |
|---|---|---|
| 1 | `01-board.png` | The shape of the system is a pipeline: New → Matched → Writing → Sent & submitted → In play → Won, plus a Parked column. Each card is one "line" — one opportunity has exactly one card, start to finish. |
| 2 | `02-sources.png` | Where cards come from: card sources. A weekly scout over aggregators, plus hand-run sweeps (watch this org, find modeling agencies…), plus "things you drop in". Each job keeps a log of its last run — including **what was checked and deliberately not turned into a card, and why**. A negative result is information too. |
| 3 | `03-drawer.png` | Opening a line gives you a drawer; the board stays visible, so scanning is not interrupted. The URL (`?p=…&d=1`) remembers where you are — a refresh doesn't throw you back to the home page. |
| 4 | `04-pursuit-full.png` | A line in full, three columns: left = facts / people / correspondence / files, middle = everything this line remembers + the box where you talk to Fairwind, right = deliverables. |
| 5 | `05-talk.png` | How the middle column grows: you ask, it goes and checks with the line's whole history in hand, and answers. It quotes the source verbatim and marks *"I opened the pages and verified it myself; this is not second-hand."* From then on, the line's judgements have provenance. |
| 6 | `06-mail.png` | Mail is really pulled in (17 messages in the left column). It can read the threads registered on this line and draft a reply — **but sending is not in its tool allowlist**. |
| 7 | `07-deliverables.png` | The right column: a form checklist, a drafted first-person statement, a word count. It can edit drafts; the **Finalize** button belongs to the browser only — the database never granted it that function. |
| 8 | `08-queue.png` | Triage: newly arrived cards queue up, you page through them ‹ › inside the drawer, and "Move out" when done. 21 new opportunities don't have to become 21 interruptions. |
| 9 | `09-pool.png` | Expand a batch and every card inside falls into the column it actually belongs to. The cards say "read through, waiting on you" — homework done, decision still yours. |
| 10 | `10-people.png` | People hands you one thing: the few that need moving now (they replied / time to bump / the date arrived / the 48-hour letter after meeting). On the right, an address book of 92 people and 26 orgs that grew out of the correspondence itself. |
| 11 | `11-profile.png` | What entitles the system to speak for you: this page. Status, base, funding preference — and the **exclusion rule / watch rule** the scout filters by. Write one of those wrong and you never see a whole class of opportunity. |
| 12 | `12-works.png` | The works library is read from hudiworks.com, and each work carries a "box" holding the private outreach layer a public site can't (3 added here). This is what it quotes from when writing application materials. |
| 13 | `13-bulk.png` | Bulk actions: tick several cards, then "Say something…" or "Run through" to handle a batch of like cards at once. |
| 14 | `14-person.png` | A contact card: relationship memory (her default first question, which address is live), the full correspondence, and a "letters to send" column on the right. |

## Three things worth stressing when you tell it

1. **Capability and guardrail are the same structure.** They aren't instructions asking it to
   behave. It can't finalize because the grant was never given; it can't send because `send`
   isn't in the tool allowlist; it can't cross into another line because every write entry
   point takes `pursuit_id` as its first argument. See `brain/README.md`.
2. **Never lose information.** Your position is information (the URL remembers it). A negative
   result is information (what was checked and skipped goes into the log). A superseded
   judgement is information (the card keeps its "2026-08-15 correction record" instead of
   quietly rewriting itself).
3. **It does the homework; you make the call.** Every place where it *could* finish
   autonomously stops one step short of you: read through, waiting on you · take it into
   deliverables, edit there, then send · confirm-to-send takes two presses.

## Re-shooting

```bash
npm run dev     # :5173
npm run brain   # :8788 — without it, the box at the bottom of a card is mute
```

## Redaction

Every third-party personal name is replaced with a placeholder label and every email address with
`[email]`. A given person carries the **same label across all 28 shots (both language sets)**, so you
can still point and say "this person" without saying who:

| Label | Who |
|---|---|
| `[Contact A]` / `[Contact B]` / … | contacts in the correspondence (venue staff, curators…) |
| `[Prof. A]` / `[Prof. B]` | the two professors on the PhD line |
| `[Faculty C]`–`[Faculty K]` | other faculty in that department |
| `[Peer A]` / `[Peer B]` / `[Peer C]` | peers / introducers |
| `[Student A]` / `[Student B]` | students |
| `[Person 1]`… | everyone else in the address book (auto-numbered in order of appearance) |
| `[Org R]` | CultureHub — the residency list is not public yet, so the org identity is masked too, along with `culturehub.org` and its founders |
| `[email]` | any email address |

**Not masked**: organisation names that carry no personal information (Theodore Payne Foundation,
SFCB and the like), the artist's own name, and his own work titles. Say the word if you want the
artist's own name masked too and both sets get re-shot.

Like the translation, the redaction is a **throw-away overlay applied in the browser at capture
time**. Not one character in the database was changed.
