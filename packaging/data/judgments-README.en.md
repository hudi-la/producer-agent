# Your judgment rules

The `.md` files in this folder are where you tell Fairwind "here is how I see this kind of thing".
Every time it judges an email or a note, it reads the matching file first.

| File | When it's used |
|---|---|
| `全部.md` | on every judgment |
| `对方来信.md` | someone wrote to you |
| `我发出的信.md` | you sent a letter |
| `手记.md` | you wrote a note (met someone, called, submitted a form) |
| `见面之后.md` | after a meeting, when Fairwind asks how it went and you answer |

(File names are fixed — Fairwind looks them up by name. Write the contents in whatever language you like.)
A missing file simply means nothing to add. Empty is fine.

## How to write them

Like briefing an assistant who knows the field. A few sentences is enough:

```
Submissions, applications and proposals: wait 30 days before I ask, no rush.
Scheduling or requests for materials: remind me after 5 days of silence.
When unsure whether a reply is needed, remind me — don't swallow it.
If a meeting time is set, the meeting wins, even if they still owe me a link.
```

No restart needed — the next judgment uses the new text.

## What has no effect

The fields Fairwind returns on each judgment (reply needed, how long to wait, meeting time, one-line gist) are fixed.
Sentences like "add a field" or "remove gist" are flagged at startup as having no effect, and everything else runs as usual.

## Try it

Under "My profile → About you" there is "See what would change": it re-judges your last twenty judged items with the current rules
and shows the old and new verdicts side by side.

## If something goes wrong

The same place has a switch: "Using my rules / Using factory rules". Turn it off and you're back to factory.
When Fairwind can't produce a verdict with your rules, it automatically retries with the factory rules and names the file in the log.
