---
name: setup-feedback-server
description: Install or upgrade FeedbackKit, establish host OAuth, authenticate an account by email or invitation, create the first Product, integrate the Apple SDK, or diagnose setup. Use for first-use onboarding, unbound connections, connection failures, or setup status; not routine feedback triage.
---

# Set up FeedbackKit

FeedbackKit uses the hosted `https://api.feedkit.cn/mcp` connector. Do not look for or run a local
MCP process, Bun runtime, CLI, local authentication store, or credential file. OAuth credentials
belong to the host and must never be requested, displayed, copied, or written by the Agent.

## OAuth connection and account binding

Anonymous access is limited to MCP discovery and `health`. The `authenticate` tool is
OAuth2-protected with an empty scopes list. Its first invocation lets the host complete OAuth, but
OAuth success leaves the connection unbound and grants no FeedbackKit account access.

Install or upgrade the trusted `feedback-server` plugin, then select exactly one authentication
method from explicit user input. Do not guess between methods.

### Email

1. Call `authenticate({ method: "email", email })` with the user's exact email. The protected call
   causes the host to complete OAuth when needed; once OAuth returns, call the same method to bind
   the account.
2. Expect `pending_verification`. Tell the user to click the one-time link in the email. Never ask
   the user to paste the link or any verification material into the conversation.
3. Observe completion with `authentication_status`, respecting any returned retry timing. Continue
   only when the status reports that the account is bound.

### Invitation

1. Read the invitation code from the user-supplied invitation Prompt and call
   `authenticate({ method: "invitation", code })`. Pass the code only as the tool input; do not
   repeat it in chat, logs, commands, previews, or the final response.
2. The protected call causes the host to complete OAuth when needed; once OAuth returns, call the
   same method to bind the account.
3. Successful invitation authentication binds immediately. Do not ask the user to enter anything
   in the OAuth browser or complete email verification.

After either method binds the account, call `connection_status`. If it still reports an unbound
connection, return to `authenticate` or `authentication_status` as directed; do not enter Product
onboarding early.

## First Product and SDK setup

Immediately after bound `connection_status`, call `get_onboarding_status`; never finish a turn by
reporting only that OAuth connected or that account binding succeeded. If there is no Product,
completely re-ask for App name, platform (`iOS`,
`iPadOS`, `macOS`, Android, or Web), default user language, the target when several Apps exist, and
an explicit notification preference: Bark, Product Webhook, or defer. Do not reuse waitlist details
or infer defer from silence. Generate a slug, show it for confirmation, and pass the saved
`notificationSetupPreference` in `create_product`; defaults remain active, private feedback, and
diagnostics off.

For an existing selected Product whose onboarding action requires a notification choice, ask
immediately and persist it with `set_notification_setup_preference` before App integration. For Bark
or Webhook, follow `$configure-notifications`, including its protected preview and confirmation. A
saved Bark or Webhook choice remains action-required until its channel is configured; an explicit
defer resolves the step. Do not claim setup is complete while a notification action is unresolved.

Before modifying an Apple project, identify the target project and files and obtain explicit
approval. Then integrate the FeedbackKit SDK, write the Product publishable key without echoing it,
build the smallest relevant target, and verify endpoint, key placement, language behavior, and SDK
initialization directly in the project. Android and Web may complete account and Product creation,
but automatic SDK integration is not available in this release.

Use the returned onboarding status for remaining server-side steps. With several Products, ask for
an explicit Product selection. Treat build or configuration failures as blockers and warnings as
review items. Run a live feedback roundtrip only when explicitly asked.
