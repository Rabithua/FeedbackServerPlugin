---
name: manage-feedback-server
description: Compatibility router for broad or ambiguous FeedbackServer requests. Use when a request spans several FeedbackServer workflows or does not clearly match setup, feedback triage, waitlist, roadmap/release publishing, notifications, or administration. Do not use for a clearly scoped workflow when its focused FeedbackServer skill applies.
---

# Route FeedbackServer work

Use the smallest focused skill that covers the request:

- `$setup-feedback-server` for installation, account connection, profiles, doctor, and first-app setup.
- `$triage-feedback` for inspecting, organizing, replying to, or deleting Product feedback and diagnostics.
- `$manage-waitlist` for owner-scoped signup follow-up and deletion.
- `$publish-roadmap-releases` for Activity posts, public roadmap content, Releases, translations, or App Store changelog import.
- `$configure-notifications` for Bark and Product Webhook configuration or deliveries.
- `$administer-feedback-server` for Products, subscriptions, access, invitations, keys, audit, and attachments outside triage.

Use only the documented `feedback-server` MCP tools. The focused setup and administration skills
document the few Keychain-backed CLI exceptions. Never use direct SQL, production shell access, or
undocumented HTTP routes. Resolve explicit IDs instead of guessing. Do not mutate for requests that
only ask to inspect, draft, preview, plan, or summarize.

When a protected tool returns `confirmation_required`, show its redacted preview and wait for an
explicit approval. Then call `execute_confirmation` with only the returned `confirmationId`. The ID
is single-use, expires after ten minutes, and becomes invalid when the active profile, account,
endpoint, payload, or precondition changes.
