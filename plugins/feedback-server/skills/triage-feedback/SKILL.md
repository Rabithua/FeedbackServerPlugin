---
name: triage-feedback
description: Inspect, summarize, organize, reply to, publish, or delete FeedbackServer Product feedback, conversations, internal notes, attachments, and diagnostic bundles. Use for inbox triage and feedback follow-up. Do not use for waitlist signups, roadmap releases, or initial account setup.
---

# Triage FeedbackServer feedback

Identify the Product first. If none is named, list Products; auto-select only one unambiguous result,
otherwise ask. Pass explicit Product and entity IDs to later tools. Follow `nextCursor` until the
requested range is complete.

Keep internal notes, client context, Visitor credentials, and diagnostic data private. Generate an
attachment URL only when explicitly asked to open or download it. Diagnostic bundles are more
sensitive: call `get_diagnostic_bundle_url` only for an explicit inspection or download request.

Explicit requests to reply, add an internal note, link, update, publish, or delete authorize the
corresponding tool. Drafting, reviewing, planning, previewing, or summarizing do not authorize a
write. Public Feedback exposes the body, attachments, author display code, and non-internal
conversation as one unit; diagnostics and internal notes remain private.

Protected changes return `confirmation_required`. Show the Product, entity, visible text or status,
and public/deletion effect from the redacted preview. After explicit approval call
`execute_confirmation({ confirmationId })`; never reconstruct the original parameters. If the ID
expires, is replayed, or the precondition is stale, reread current state and prepare a new preview.
Never automatically retry a write. Public replies must be shown in full before sending.

Preserve error status, code, message, request ID, retry guidance, and remediation. On 401 route to
`$setup-feedback-server`; on 403 report the missing access and stop. Never ask for a token in chat.
