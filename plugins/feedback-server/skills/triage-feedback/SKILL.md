---
name: triage-feedback
description: Inspect, summarize, organize, reply to, publish, or delete FeedbackServer 2.0 Product feedback, conversations, internal notes, attachments, and diagnostic bundles. Use for inbox triage and feedback follow-up. Do not use for waitlist signups, roadmap Releases, or initial setup.
---

# Triage FeedbackServer 2.0 feedback

Verify the connected account with `whoami` when needed. Resolve the Product with `list_products` and
the record with `list_feedback` or `get_feedback`; auto-select only one unambiguous result. Otherwise
ask. Pass explicit Product and entity IDs to later tools and follow `nextCursor` until the requested
range is complete.

Keep internal notes, client context, visitor credentials, waitlist data, and diagnostics private.
Call `get_attachment_url` only when the task requires an attachment, and call
`get_diagnostic_bundle_url` only for an explicit diagnostic inspection or download request.

An explicit request to change a specific Feedback record's status or visibility authorizes the exact
`update_feedback` call. An explicit request to send specified reply text authorizes the exact
`reply_to_feedback` call. Execute either ordinary write once without asking the user to approve the
same action again. Explicit requests for an internal note or Item link similarly authorize the
matching direct tool. Drafting, reviewing, planning, previewing, or summarizing does not authorize a
write. Public Feedback exposes its body, attachments, author display code, and non-internal thread as
one unit; diagnostics and internal notes remain private.

Deletion and any other tool marked risky prefer native MCP elicitation. If elicitation is unavailable
and a call returns `confirmation_required`, show the exact Product, entity, visible or destructive
effect, and full public text when relevant. After explicit approval, repeat the same tool with
identical arguments plus `confirm: true`. Never use a confirmation identifier or alter the approved
payload. If state changed, reread it and seek fresh approval; never retry a write automatically.

Preserve error status, code, message, request ID, retry guidance, and remediation. On 401 route to
`$setup-feedback-server`; on 403 report the missing scope or access and stop. Never ask for a token.
