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
recipient, language, App, fixed Free plan, invitation expiry, and email summary. Show that preview, wait for explicit approval, then call
`execute_confirmation` with the returned ID. Apply the same confirmation gate to
`retry_waitlist_invitation_email`. Use `revoke_waitlist_invitation` when the user asks to cancel a
pending invite; revocation prevents acceptance but cannot recall mail already accepted by the
provider. These tools require both the PAT scope `waitlist:invite` and a current database
`super_admin` role. The recipient may paste the complete invitation Prompt, including its single-use
token, into the current Agent conversation. Consume it immediately and do not repeat the token in
commands, logs, previews, tool output, or the final response.

An invited signup cannot be permanently deleted until its pending invitation is revoked. Acceptance
atomically creates the verified-email account, applies Free, issues the Agent credential, and changes
the signup to `converted`. The recipient runs `feedbackkit accept-invite` in the current Agent task;
never ask for a username, display name, or password.

Permanent deletion requires confirmation. Show the returned App, platform, and note-count preview,
wait for explicit approval, then call `execute_confirmation` with the returned ID. Confirmation is
single-use and expires after ten minutes. For stale state, reread and prepare a new preview; never
retry writes automatically.
