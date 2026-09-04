---
name: manage-waitlist
description: List, inspect, search, annotate, update, invite, archive, convert, or permanently delete the connected FeedbackServer 2.0 administrator's waitlist signups. Use for waitlist and early-access follow-up. Do not select a Product or use this for Product feedback.
---

# Manage the FeedbackServer 2.0 waitlist

Waitlist entries belong to the connected administrator and are not Product-scoped. Do not ask for a
Product. Use `list_waitlist_entries` and `get_waitlist_entry`, apply status, platform, and search
filters, and follow `nextCursor`. Archived entries are hidden unless explicitly requested. Treat
email as private contact data and include it only when the task needs it.

`update_waitlist_status` and `add_waitlist_note` are direct internal writes after resolving the exact
entry. Valid statuses are `new`, `contacted`, `invited`, `converted`, and `archived`. Do not substitute
archive for a requested permanent deletion or vice versa.

Invitation email is a protected external effect. `invite_waitlist_entry` requires an exact recipient,
language, App, subscription grant, and expiry. Free needs no term; Solo and Studio require an explicit
month, year, or perpetual term. Never infer one. Use the same protection for
`retry_invitation_email`; use `revoke_invitation` to cancel a pending invitation before deleting a
blocked signup. Revocation cannot recall mail already accepted by the provider.

The invitation recipient's Agent workflow consumes only `mcp_server` and `account_email`. The user
signs in as that email through the browser magic-link flow, then the Agent verifies the account with
`whoami`. Do not ask for a username, display name, password, emailed link, or any additional
invitation credential.

For invitations, retries, revocation, and `delete_waitlist_entry`, prefer native MCP elicitation. If
the client cannot elicit and the tool returns `confirmation_required`, show the exact redacted effect,
wait for approval, then repeat the same tool with identical arguments plus `confirm: true`. Never use
a confirmation identifier. Reread state after a conflict and never retry a mutation automatically.
