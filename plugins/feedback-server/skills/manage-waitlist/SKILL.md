---
name: manage-waitlist
description: List, inspect, search, annotate, update, archive, convert, or permanently delete the connected FeedbackServer administrator's waitlist signups. Use for waitlist and early-access follow-up. Do not select a Product or use this for Product feedback.
---

# Manage the FeedbackServer waitlist

Waitlist entries belong to the connected administrator and are not Product-scoped. Do not ask for a
Product. Use status, platform, and search filters; archived entries are hidden unless explicitly
requested. Follow `nextCursor` for the requested range. Treat email as private contact data and
include it only when the task needs it.

`update_waitlist_status` and `add_waitlist_note` are direct internal writes after resolving the exact
entry. Valid status values are `new`, `contacted`, `invited`, `converted`, and `archived`. Do not
substitute archive for a requested permanent deletion or vice versa.

Permanent deletion requires confirmation. Show the returned App, platform, and note-count preview,
wait for explicit approval, then call `execute_confirmation` with the returned ID. Confirmation is
single-use and expires after ten minutes. For stale state, reread and prepare a new preview; never
retry writes automatically.
