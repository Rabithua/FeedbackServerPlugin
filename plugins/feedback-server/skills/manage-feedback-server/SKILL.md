---
name: manage-feedback-server
description: General router for broad or ambiguous FeedbackServer requests. Use when a request spans several FeedbackServer workflows or does not clearly match setup, feedback triage, waitlist, roadmap/release publishing, notifications, or administration. Do not use for a clearly scoped workflow when its focused FeedbackServer skill applies.
---

# Route FeedbackServer work

Use the smallest focused skill that covers the request:

- `$setup-feedback-server` for installation, host OAuth, explicit account authentication, connection diagnosis, and first-app setup.
- `$triage-feedback` for inspecting, organizing, replying to, or deleting Product feedback and diagnostics.
- `$manage-waitlist` for owner-scoped signup follow-up and deletion.
- `$publish-roadmap-releases` for Activity posts, public roadmap content, Releases, translations, or App Store changelog import.
- `$configure-notifications` for Bark and Product Webhook configuration or deliveries.
- `$administer-feedback-server` for Products, subscriptions, access, invitations, keys, audit, and attachments outside triage.

Use only the documented remote `feedback-server` MCP tools. There are no local CLI exceptions.
Never use direct SQL, production shell access, or
undocumented HTTP routes. Resolve explicit IDs instead of guessing. Do not mutate for requests that
only ask to inspect, draft, preview, plan, or summarize.

An explicit user request to change Feedback status or visibility, or to send a Feedback reply,
authorizes that exact tool call without a second confirmation. Read-only review, drafting, and
planning do not authorize a write. When another protected tool returns `confirmation_required`, show
its redacted preview and wait for explicit approval. Then call `execute_confirmation` with only the
returned `confirmationId`; it remains single-use and bound to the connection, account, endpoint,
payload, and precondition.
