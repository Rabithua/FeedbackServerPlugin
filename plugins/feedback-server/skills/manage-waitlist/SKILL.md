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

Invitation email is a protected external effect. Use `invite_waitlist_entry` to preview the exact
recipient, language, App, subscription grant, invitation expiry, and email summary. The default is
Free. Solo and Studio require an explicit month, year, or perpetual term; ask when the user names a
paid plan without a term and never infer one. Show that preview, wait for explicit approval, then call
`execute_confirmation` with the returned ID. Apply the same confirmation gate to
`retry_waitlist_invitation_email`. Use `revoke_waitlist_invitation` when the user asks to cancel a
pending invite; revocation prevents acceptance but cannot recall mail already accepted by the
provider. These tools require both the OAuth scope `waitlist:invite` and a current database
`super_admin` role. The recipient may paste the complete invitation Prompt into the current Agent
conversation. Use its token only in anonymous `accept_invitation`; do not repeat it in commands,
logs, previews, tool output, or the final response.

An invited signup cannot be permanently deleted until its pending invitation is revoked. Acceptance
atomically creates the verified-email account, applies the selected grant, creates the OAuth grant
and authorization code, and changes the signup to `converted`. The Agent shows the short connection
code and triggers OAuth once. A same-browser handoff loads the invitation automatically; an isolated
browser asks for the short code. The recipient reviews the recognized invitation and accepts without
a second email code. Never ask for a username, display name, or password.

Permanent deletion requires confirmation. Show the returned App, platform, and note-count preview,
wait for explicit approval, then call `execute_confirmation` with the returned ID. Confirmation is
single-use and expires after ten minutes. For stale state, reread and prepare a new preview; never
retry writes automatically.
