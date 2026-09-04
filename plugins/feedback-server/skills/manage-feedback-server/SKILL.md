---
name: manage-feedback-server
description: General router for broad or ambiguous FeedbackServer 2.0 requests. Use when work spans several workflows or does not clearly match setup, feedback triage, waitlist, roadmap and Release publishing, notifications, or administration. Do not use for a clearly scoped workflow when its focused skill applies.
---

# Route FeedbackServer 2.0 work

Use the smallest focused skill that covers the request:

- `$setup-feedback-server` for installation, browser OAuth, magic-link sign-in, `whoami`, connection
  diagnosis, first-Product setup, and App integration.
- `$triage-feedback` for inspecting, organizing, replying to, or deleting Product feedback and
  diagnostics.
- `$manage-waitlist` for owner-scoped signup follow-up, invitation, and deletion.
- `$publish-roadmap-releases` for Developer Posts, public roadmap Items, Releases, translations, or
  App Store changelog import.
- `$configure-notifications` for Bark and Product webhook configuration or deliveries.
- `$administer-feedback-server` for Products, subscriptions, account access, invitations, keys,
  audit, and attachments outside triage.

Use only documented remote `feedback-server` MCP tools. There is no local CLI exception. Never use
direct SQL, production shell access, or undocumented HTTP routes. Start with `whoami` when identity
matters, resolve exact IDs with list/get tools, and do not mutate for requests that only ask to
inspect, draft, preview, plan, or summarize.

An explicit request to change Feedback status or visibility, or to send a specified Feedback reply,
authorizes that exact ordinary write without a duplicate chat confirmation. Other tools marked risky
prefer native MCP elicitation. If elicitation is unavailable and the tool returns
`confirmation_required`, show its target and exact redacted effect, wait for explicit approval, then
repeat the same operation with unchanged arguments plus `confirm: true`. Never use a confirmation
identifier, change the payload on the confirmed call, or retry a mutation automatically.
